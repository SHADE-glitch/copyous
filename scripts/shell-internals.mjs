#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — re-derive the shell-internal dependency inventory.
//
//   node scripts/shell-internals.mjs            # table for docs/maintenance/shell-internals.md
//   node scripts/shell-internals.mjs --json     # machine-readable, for a before/after diff
//
// The symbol list is a property of the code, so it must not be hand-copied into the
// handbook: a rename or a deletion in lib/ would otherwise leave a plausible-looking
// row pointing at something that no longer exists. This script prints columns one to
// three of that table (symbol, files, counts). The judgement columns -- why it is
// unavoidable, and what the upgrade symptom is -- stay in the markdown, and whoever
// edits the code is the one who has to update them.
//
// Upgrading GNOME is the moment this is worth running: diff the old output against the
// new one and every vanished symbol shows up, which is what a rename-in-the-shell
// looks like from our side.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Shell-side surface only. lib/preferences/** runs in its own gjs process against the
// blessed prefs path, and mixing the two risk classes into one table makes both useless.
const SHELL_ROOTS = ['extension.js', 'lib', 'thirdparty'];
const EXCLUDED = [path.join('lib', 'preferences')];

const files = [];
const walk = (rel, into = files) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs))
        return;
    if (fs.statSync(abs).isFile()) {
        if (rel.endsWith('.js'))
            into.push(rel);
        return;
    }
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === 'node_modules' || e.name.startsWith('.'))
            continue;
        const r = rel ? path.join(rel, e.name) : e.name;
        if (EXCLUDED.includes(r))
            continue;
        walk(r, into);
    }
};
SHELL_ROOTS.forEach((rel) => walk(rel));

// The prefs tree is excluded from the inventory above (different process, different risk
// class), but the optional-namespace invariant spans both: a static import of a typelib
// the prefs page also probes breaks the settings window exactly as badly.
const prefFiles = [];
walk(path.join('lib', 'preferences'), prefFiles);

// MODULE -> { files: Set, symbols: Map<symbol, Set<file>> }
const mod = new Map();
const blessedPrefsPath = new Map();
const add = (moduleName, symbol, file) => {
    if (!mod.has(moduleName))
        mod.set(moduleName, new Map());
    const symbols = mod.get(moduleName);
    if (!symbols.has(symbol))
        symbols.set(symbol, new Set());
    symbols.get(symbol).add(file);
};

const IMPORT_RESOURCE = /import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from\s+['"]resource:\/\/\/org\/gnome\/(shell|Shell)\/([^'"]+)['"]/g;
const ACCESS = (alias) => new RegExp(`\\b${alias}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
// `global.*` and the two gi namespaces whose members are shell-internal ABI. Everything
// else in gi:// is a stable, versioned typelib and does not belong in this inventory.
// The lookbehind matters: `org.gnome.Shell.Extensions.Copyous` is a D-Bus name, and
// `Meta.` / `Shell.` inside it used to be counted as two dependencies.
const GLOBAL_USE = /(?<![.\w])global\.([A-Za-z_][A-Za-z0-9_]*)/g;
const NAMESPACE_USE = /(?<![.\w])(Shell|Meta)\.([A-Za-z_][A-Za-z0-9_]*)/g;

// Import statements are removed before usages are matched: `import * as animationUtils
// from '...animationUtils.js'` otherwise reports a symbol named `js`.
const stripImports = (src) => src.replace(/^\s*import\s[^;]*;/gm, '');

for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const body = stripImports(src);

    for (const m of src.matchAll(IMPORT_RESOURCE)) {
        const [, star, braces, bare, case_, subpath] = m;
        const moduleName = `resource:///org/gnome/${case_}/${subpath}`;
        if (case_ === 'Shell') {          // the documented prefs-only path
            blessedPrefsPath.set(moduleName, (blessedPrefsPath.get(moduleName) ?? new Set()).add(rel));
            continue;
        }
        const alias = star ?? bare ?? 'default';
        const named = braces
            ? braces.split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)
            : [];
        if (star) {
            for (const u of body.matchAll(ACCESS(alias)))
                add(moduleName, u[1], rel);
        } else {
            for (const n of named.length ? named : [alias])
                add(moduleName, n, rel);
        }
    }

    for (const m of body.matchAll(GLOBAL_USE))
        add('global', m[1], rel);
    for (const m of body.matchAll(NAMESPACE_USE))
        add(`gi://${m[1]}`, m[2], rel);
}

const rows = [];
for (const [moduleName, symbols] of [...mod].sort()) {
    for (const [symbol, where] of [...symbols].sort()) {
        rows.push({
            module: moduleName,
            symbol,
            files: [...where].sort(),
        });
    }
}

function findLibshell() {
    const dir = '/usr/lib/gnome-shell';
    if (!fs.existsSync(dir))
        return null;
    const hit = fs.readdirSync(dir).filter((f) => /^libshell-\d+\.so$/.test(f)).sort().pop();
    return hit ? path.join(dir, hit) : null;
}

// Every gi:// namespace the shell's own modules import. `gresource` has no `show`
// subcommand; list + extract is the only way in.
function shellOwnNamespaces(libshell) {
    try {
        const list = execFileSync('gresource', ['list', libshell], { encoding: 'utf8', maxBuffer: 1 << 26 })
            .split('\n').filter((p) => p.endsWith('.js'));
        const out = new Set();
        for (const p of list) {
            let body = '';
            try {
                body = execFileSync('gresource', ['extract', libshell, p], { encoding: 'utf8', maxBuffer: 1 << 26 });
            } catch {
                continue;
            }
            for (const m of body.matchAll(/gi:\/\/([A-Za-z0-9]+)/g))
                out.add(m[1]);
        }
        return out;
    } catch {
        return new Set();
    }
}

// ---------------------------------------------------------------------------
// Which typelibs are guaranteed to exist.
//
// This is not a preference list: it is what `gresource list + extract` over the shell's
// own JS modules yields on GNOME 50.1 / gjs 1.88 (the 2026-10-09 derivation), i.e. the
// namespaces the shell process itself imports, and therefore the ones a GNOME install
// necessarily has. Anything outside it -- Gda, GSound, Gst, the hljs download -- can be
// absent on a user's machine, so it must be loaded with `await import()` and handled.
//
// The literal can drift as the shell changes, which is what the third rule below checks
// whenever libshell is on the machine.
// ---------------------------------------------------------------------------
const GUARANTEED = new Set(['Atk', 'Atspi', 'cairo', 'Clutter', 'Cogl', 'Gcr', 'Gdk', 'GdkPixbuf',
    'Geoclue', 'Gio', 'GioUnix', 'GLib', 'GnomeBG', 'GnomeBluetooth', 'GnomeDesktop', 'GObject',
    'Graphene', 'Gvc', 'IBus', 'Meta', 'Mtk', 'NM', 'Pango', 'Rsvg', 'Shell', 'Soup', 'St',
    // not imported by the shell's own modules but installed with it, and used only by the
    // separate prefs process -- see the note on process split in the docs:
    'Adw', 'Gtk', 'GDesktopEnums', 'AccountsService', 'Gdm', 'GWeather', 'Malcontent',
    'Polkit', 'PolkitAgent', 'UPowerGlib', 'NMA4']);

// Rule 1 -- contradiction: a namespace loaded with `await import('gi://X')` somewhere has
// been declared optional by this codebase. A static `import X from 'gi://X'` for that same
// namespace then contradicts it, because gjs throws while *resolving the module*, before
// the first statement of that file runs. Not a missing feature -- an extension that does
// not load at all. (Proved on this machine with `gjs -m` against a nonexistent namespace:
// the log line after the import never printed. The dynamic form is catchable.)
const DYN = /import\(\s*['"]gi:\/\/([A-Za-z0-9]+)/g;
const STA = /^\s*import\s+[A-Za-z_$][\w$]*\s+from\s+['"]gi:\/\/([A-Za-z0-9]+)/gm;
const dyn = new Map();
const stat = new Map();
for (const rel of [...files, ...prefFiles]) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    for (const m of src.matchAll(DYN))
        dyn.set(m[1], (dyn.get(m[1]) ?? new Set()).add(rel));
    for (const m of src.matchAll(STA))
        stat.set(m[1], (stat.get(m[1]) ?? new Set()).add(rel));
}
const contradicted = [...dyn.keys()].filter((n) => stat.has(n)).sort();

// The prefs process has a different install set (it is plain gjs + libadwaita, and it may use
// Gtk/Gdk), so a namespace imported *only* there must never appear in the shell-side list --
// otherwise the printed set looks like it contradicts the "no gi://Gtk/Gdk in the shell process"
// fact in docs/maintenance/compatibility-matrix.md, which it does not.
const PREFS = path.join('lib', 'preferences');
const shellSideFiles = (n) => [...(stat.get(n) ?? [])].filter((f) => !f.startsWith(PREFS));
const staticShellSide = [...stat.keys()].filter((n) => shellSideFiles(n).length).sort();
const staticPrefsOnly = [...stat.keys()].filter((n) => !shellSideFiles(n).length).sort();

// Rule 2 -- the rule that would have caught F19 before it shipped: gi://Gst was a *static*
// import in contentInfo.js and never dynamic, so rule 1 alone sees nothing. A shell-side
// static import outside the guaranteed set is the same defect in its first appearance.
// Scoped to the shell process on purpose: the prefs process has a different install set.
const unguaranteed = [...stat.keys()]
    .filter((n) => !GUARANTEED.has(n))
    .filter((n) => shellSideFiles(n).length)
    .sort();

// Rule 3 -- keep the literal honest. Only possible where libshell is installed.
const libshell = findLibshell();
let drift = null;
if (libshell) {
    const derived = shellOwnNamespaces(libshell);
    if (derived.size) {
        const onlyInLiteral = [...GUARANTEED].filter((n) => !derived.has(n) && !['Adw', 'Gtk'].includes(n)).sort();
        drift = onlyInLiteral;
    }
}


if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
        scannedFiles: files.length,
        modules: new Set(rows.map(r => r.module)).size,
        symbols: rows.length,
        blessedPrefsImports: [...blessedPrefsPath.entries()].map(([m, f]) => [m, [...f].length]),
        optionalNamespaces: [...dyn.keys()].sort(),
        staticallyImported: staticShellSide,
        staticallyImportedByPrefsOnly: staticPrefsOnly,
        contradicted,
        unguaranteed,
        libshell,
        literalDrift: drift,
        rows,
    }, null, 1) + '\n');
    process.exit(contradicted.length || unguaranteed.length || (drift && drift.length) ? 2 : 0);
}

for (const r of rows)
    console.log(`${r.module}\t${r.symbol}\t${r.files.join(', ') || '(imported, no call site found)'}`);

const touching = new Set(rows.flatMap(r => r.files));
console.log('');
console.log(`scanned shell-side files : ${files.length}`);
console.log(`private modules          : ${new Set(rows.map(r => r.module)).size}`);
console.log(`private symbols          : ${rows.length}`);
console.log(`files with a dependency   : ${touching.size}`);
for (const [m, f] of blessedPrefsPath)
    console.log(`blessed prefs path       : ${m} used by ${f.size} file(s) under lib/preferences/ (not counted above)`);

const failures = [];
console.log('');
console.log(`optional namespaces (dynamic import) : ${[...dyn.keys()].sort().join(', ') || '(none)'}`);
for (const n of contradicted) {
    console.log(`FAIL: gi://${n} is loaded dynamically in ${[...dyn.get(n)].join(', ')} but imported statically in ${[...stat.get(n)].join(', ')}`);
    failures.push(n);
}
console.log(`statically imported (shell-side)     : ${staticShellSide.join(', ') || '(none)'}`);
console.log(`statically imported (prefs process)  : ${staticPrefsOnly.join(', ') || '(none)'} -- separate install set, not judged here`);
for (const n of unguaranteed) {
    console.log(`FAIL: gi://${n} is imported statically in ${[...stat.get(n)].filter((f) => !f.startsWith(path.join('lib', 'preferences'))).join(', ')} but the shell's own install set does not guarantee it -- a machine without that typelib cannot load the extension at all`);
    failures.push(n);
}
if (libshell) {
    const derived = shellOwnNamespaces(libshell);
    console.log(`guaranteed-set cross-check         : ${libshell} yields ${derived.size} namespaces`);
    if (drift && drift.length) {
        for (const n of drift)
            console.log(`FAIL: GUARANTEED lists ${n}, which the shell's own modules no longer import -- the literal has drifted`);
        failures.push(...drift.map((d) => `literal:${d}`));
    }
} else {
    console.log('guaranteed-set cross-check         : INERT (no libshell-*.so on this machine; rules 1 and 2 still ran)');
}
console.log('');
console.log(failures.length ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failures.length ? 2 : 0);
