#!/usr/bin/env node
// Inventory of settings keys vs the preferences window that is supposed to expose them.
//
// Pure static analysis: no gjs, no gi, no shell. Run it with `node scripts/settings-coverage.mjs`.
// It reads the schema and the prefs sources, then answers three questions:
//
//   1. which keys have no control at all?   -> invisible setting (or deliberately migrated away)
//   2. which keys have a control but no reset? -> goal 4 ("one-click restore") gap        [FAIL]
//   3. which keys does prefs name that the schema lacks? -> a typo                        [FAIL]
//
// Question 3 matters because `makeResettable` returns early when `get_default_value()` gives
// back null: a misspelled key produces *no reset button and no error*, so the defect is
// invisible at runtime. In `settings.bind('k', widget, 'prop', flags)` and
// `get_boolean('k')` the first argument is always resolved against the schema, so a name there
// that the schema does not declare is a typo and nothing else.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (name.endsWith('.js')) out.push(p);
	}
	return out;
}

// --- schema -----------------------------------------------------------------------------

const SCHEMA_FILE = join(ROOT, 'schemas', 'org.gnome.shell.extensions.copyous.gschema.xml');
const schemaText = readFileSync(SCHEMA_FILE, 'utf8');

// Each `<schema id=... path=...>` block owns the `<key name=...>` lines that follow it until
// the closing tag. Key names repeat across child schemas, so a key is only unique as
// `<path>/<name>`.
const schemas = [];
{
	const block = /<schema\s+[^>]*id="([^"]+)"[^>]*path="([^"]+)"[^>]*>([\s\S]*?)<\/schema>/g;
	let m;
	while ((m = block.exec(schemaText))) {
		const [, id, path, body] = m;
		const keys = new Map();
		// `type=`, `enum=` and `flags=` are the three ways gsettings declares a value type.
		// Dropping `flags=` silently loses a key, and a lost key cannot be reported on.
		const key = /<key\s+name="([^"]+)"[^>]*?(?:type="([^"]+)"|enum="([^"]+)"|flags="([^"]+)")[\s\S]*?<default(?:\s+xml:lang="[^"]*")?\s*>([\s\S]*?)<\/default>/g;
		let k;
		while ((k = key.exec(body))) {
			keys.set(k[1], {
				type: k[2] !== undefined ? k[2] : k[3] !== undefined ? `enum:${k[3]}` : `flags:${k[4]}`,
				default: k[5].trim(),
			});
		}
		schemas.push({ id, path, keys });
	}
}
if (schemas.length === 0) {
	console.error('settings-coverage: parsed no schemas -- the regex and the file have diverged');
	process.exit(1);
}

const allKeyNames = new Set(schemas.flatMap((s) => [...s.keys.keys()]));
const colliding = new Map();
for (const s of schemas) {
	for (const name of s.keys.keys()) colliding.set(name, (colliding.get(name) ?? 0) + 1);
}

// --- prefs sources ----------------------------------------------------------------------

const prefsFiles = walk(join(ROOT, 'lib', 'preferences'));
const bound = new Map(); // key name attached to a widget (a real control)
const used = new Map(); // key name only read or written by code, no widget
const reset = new Map(); // key name passed to makeResettable
const children = new Map(); // get_child('x') -> files
const phantom = new Map(); // string used in a settings-call position but absent from the schema -> files
const opaque = new Map(); // a settings bind whose key is not a literal -- invisible to this script

function note(map, name, file) {
	if (!map.has(name)) map.set(name, new Set());
	map.get(name).add(file);
}

// `file:line  key  ->  widget` for every control the schema owns, so a gap can be worked
// file by file instead of hunted for.
const sites = [];
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

for (const abs of prefsFiles) {
	const rel = relative(ROOT, abs).replaceAll('\\', '/');
	const src = readFileSync(abs, 'utf8');

	// Which sub-schema this file reaches for.
	const child = /get_child\(\s*'([a-z0-9-]+)'/g;
	let c;
	while ((c = child.exec(src))) {
		if (!children.has(c[1])) children.set(c[1], new Set());
		children.get(c[1]).add(rel);
	}

	// A control is a settings call that names a widget. Two shapes are used in this tree:
	//   settings.bind('key', widget, 'prop', flags)
	//   bind_enum(settings, 'key', widget, 'prop')   (also bind_flags / bind_color)
	// Everything else that names a key (`get_boolean('k')`) reads a value for logic and is not
	// a control, so it cannot be counted as covered.
	const METHOD_BIND = /\.bind\(\s*'([a-z0-9][a-z0-9-]*)'\s*,\s*([A-Za-z_$][\w.]*)/g;
	const HELPER_BIND = /(?:\b|\.)(bind_enum|bind_flags|bind_color)\(\s*[^,]+,\s*'([a-z0-9][a-z0-9-]*)'\s*,\s*([A-Za-z_$][\w.]*)/g;
	const ACCESS = /\.(?:get|set)_(?:boolean|int|double|string|value|default_value|user_value|enum|strv|flags)\(\s*'([a-z0-9][a-z0-9-]*)'/g;
	let b;
	while ((b = METHOD_BIND.exec(src))) {
		if (allKeyNames.has(b[1])) {
			note(bound, b[1], rel);
			sites.push({ file: rel, line: lineOf(src, b.index), key: b[1], widget: b[2], kind: 'bind' });
		} else note(phantom, b[1], rel);
	}
	while ((b = HELPER_BIND.exec(src))) {
		if (allKeyNames.has(b[2])) {
			note(bound, b[2], rel);
			sites.push({ file: rel, line: lineOf(src, b.index), key: b[2], widget: b[3], kind: b[1] });
		} else note(phantom, b[2], rel);
	}
	while ((b = ACCESS.exec(src))) {
		if (allKeyNames.has(b[1])) note(used, b[1], rel);
		else note(phantom, b[1], rel);
	}

	// The escape hatch: `.bind(key, widget, 'prop', flags)` is a real settings bind that names
	// no literal, so nothing above can see it. Function.prototype.bind takes one argument and
	// cannot match this shape. Measured 2026-10-09: zero occurrences -- if that ever changes,
	// the gate has to be taught before the code is written, not after.
	// The `(?<!function\s)` guard is not decoration: `function bind_color(settings, key, target)`
	// in themeCustomization.js is a *declaration* whose parameter list is textually identical to
	// an opaque call, and matching it produced a false FAIL on the first run.
	const OPAQUE = /\.(?:bind)\(\s*[A-Za-z_$][\w.]*\s*,\s*[A-Za-z_$][\w.]*\s*,\s*'/g;
	const OPAQUE_HELPER = /(?<!function\s)\b(?:bind_enum|bind_flags|bind_color)\(\s*[^,()]+,\s*[A-Za-z_$][\w.]*\s*[,)]/g;
	for (const re of [OPAQUE, OPAQUE_HELPER]) {
		let o;
		while ((o = re.exec(src))) note(opaque, o[0].replace(/\s+/g, ' '), rel);
	}

	// makeResettable(row, settings, 'k1', 'k2', ...) -- only the trailing string args.
	// The definition itself lives in utils.js and takes `...keys`, so skip that file.
	if (rel !== 'lib/preferences/utils.js') {
		const r = /makeResettable\(\s*([A-Za-z_$][\w.]*),\s*[^,]+,\s*([^)]*)\)/g;
		let m2;
		while ((m2 = r.exec(src))) {
			const found = [...m2[2].matchAll(/'([a-z0-9][a-z0-9-]*)'/g)];
			if (found.length === 0) {
				console.error(`settings-coverage: makeResettable with no string keys in ${rel}: ${m2[2].trim()}`);
				continue;
			}
			for (const arg of found) {
				if (allKeyNames.has(arg[1])) {
					note(reset, arg[1], rel);
									} else note(phantom, arg[1], rel); // makeResettable bails silently when the schema has no such key
			}
		}
	}
}

// --- report -----------------------------------------------------------------------------

const rows = [];
for (const s of schemas) {
	for (const [name, meta] of s.keys) {
		rows.push({
			full: `${s.path}${name}`,
			schema: s.id.split('.').pop() === 'copyous' ? '(root)' : s.id.replace(/^.*\.copyous\./, ''),
			name,
			type: meta.type,
			default: meta.default,
						bound: bound.has(name),
				used: used.has(name),
			reset: reset.has(name),
		});
	}
}

const pad = (v, n) => String(v).padEnd(n);
const table = (list) =>
	list
		.map((r) => `    ${pad(r.name, 34)} ${pad(r.schema, 14)} ${pad(r.type, 10)} ${pad(r.default, 12)}`)
		.join('\n');

// The instrument checks itself first: a key the parser lost can never appear in any of the
// lists below, so "81 of 82 parsed" would silently understate the gap.
const declaredKeys = (schemaText.match(/<key\s+name="/g) ?? []).length;
if (declaredKeys !== rows.length) {
	console.error(
		`settings-coverage: the schema declares ${declaredKeys} keys but the parser found ${rows.length} -- report is missing keys`,
	);
	process.exit(2);
}

const noControl = rows.filter((r) => !r.bound && !r.used);
const readOnly = rows.filter((r) => !r.bound && r.used);
const noReset = rows.filter((r) => r.bound && !r.reset);
const covered = rows.filter((r) => r.reset);
// A reset button whose key has no detected control means the two regexes disagree about the
// same file -- the instrument is blind somewhere, and a blind instrument reads green.
const resetWithoutControl = rows.filter((r) => r.reset && !r.bound);

// Key names repeat across child schemas, so a gap prints every control site it could be.
// Pairing a reset to its control *widget* is deliberately not checked: a composite row owns
// several keys by design (`position` fronts the six placement keys, `playSound` the sound and
// volume keys, an exclusions row the whole exclusions page), so a widget-level claim is a
// stream of false alarms. The key-level invariant is the one that is both true and useful:
// a key with a control has a reset naming it in the same file -- and that is also what catches
// a typo, because `makeResettable` bails out silently when the schema has no such key.
const sitesOf = (name) => sites.filter((s) => s.key === name && !reset.get(name)?.has(s.file));

console.log(`schemas: ${schemas.length}  keys: ${rows.length}  prefs files: ${prefsFiles.length}`);
console.log(`key names colliding across schemas: ${[...colliding].filter(([, n]) => n > 1).map(([k, n]) => `${k}(${n})`).join(' ') || 'none'}`);
console.log(`get_child names used in prefs: ${[...children.keys()].sort().join(' ') || 'none'}`);
console.log('');
console.log(`-- controls with a reset button: ${covered.filter((r) => r.bound).length}/${rows.filter((r) => r.bound).length} controls`);
console.log(`-- controls WITHOUT a reset button: ${noReset.length}`);
for (const r of noReset) {
	const list = sitesOf(r.name);
	for (const s of list) {
		console.log(
			`    ${pad(`${s.file}:${s.line}`, 62)} ${pad(r.name, 34)} ${pad(s.widget, 24)} ${s.kind}`,
		);
	}
}
console.log('');
console.log(`-- reset on a key with no detected control (instrument blind spot): ${resetWithoutControl.length}`);
console.log(table(resetWithoutControl));
console.log('');
console.log(`-- keys with no widget at all in prefs: ${noControl.length}`);
console.log(table(noControl));
console.log(`-- keys only read/written by code, never bound to a widget: ${readOnly.length}`);
console.log(table(readOnly));
console.log('');
console.log(`-- used by prefs but absent from the schema: ${phantom.size}`);
for (const [name, files] of [...phantom].sort()) console.log(`    ${pad(name, 34)} ${[...files].join(', ')}`);
console.log(`-- binds this script cannot read (key is a variable): ${opaque.size}`);
for (const [shape, files] of opaque) console.log(`    ${pad(shape, 50)} ${[...files].join(', ')}`);

// A key with no control is a finding, not a failure: `paste-on-copy` is deprecated and is
// migrated away by `lib/common/settings.js`, so it deliberately has no row.
// What cannot be deliberate: a typoed key, a reset whose control the parser cannot see, a
// reset on the wrong widget, and -- the goal 4 gate -- a control the user cannot reset.
const failed = [
	phantom.size > 0 && 'keys used by prefs that the schema does not declare',
	opaque.size > 0 && 'a settings bind whose key is a variable, which this script cannot audit',
	resetWithoutControl.length > 0 && 'a reset button whose key has no detected control',
		noReset.length > 0 && `${noReset.length} controls have no way back to their default`,
].filter(Boolean);
console.log('');
if (failed.length) {
	for (const f of failed) console.log(`FAIL: ${f}`);
	console.log('RESULT: FAIL');
	process.exit(1);
}
console.log('RESULT: PASS');
process.exit(0);
