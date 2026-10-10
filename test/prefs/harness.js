// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — prefs harness: builds the real preferences window and asserts
// that every control on it can be identified without guessing.
//
// Why this exists as a separate process. `lib/preferences/**` is Gtk/Adw code that the
// shell must never import, so the `test/headless/` probes (which run *inside* a shell)
// cannot reach it -- and GJS caches ES modules for the lifetime of the shell, so editing
// shell-side JS otherwise costs a logout. The prefs dialog runs in its own process, so
// this harness is the one part of the verification playbook that can be re-run freely.
//
// How it loads without the shell:
//   * `org.gnome.Shell.Extensions.src.gresource` is registered by hand, which is where
//     `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` lives.
//   * Module-level `gettext` in the extension walks the JS stack for a path containing
//     `/gnome-shell/extensions/`, takes the basename as a uuid and asks the extension
//     manager for that entry's `stateObj`. A bare `import` of prefs.js therefore dies on
//     the first translated string unless the manager holds an entry (built here with the
//     shell's own `serializeExtension`) and `stateObj` is set before `fillPreferencesWindow`.
//   * `GSETTINGS_BACKEND=memory` keeps `migrateSettings()` and every `settings.bind()` off
//     the real dconf. Running this against a user's session must never write their settings.
//   * Xvfb provides the display; Adw refuses to build a window without one.
//
// The checks are deliberately mechanical (empty string / non-empty string), because "is
// this row understandable" is not testable but "does it say anything at all" is, and every
// one of the four below has already caught a real gap on this repository.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import System from 'system';

const ROOT = GLib.getenv('COPYOUS_PREFS_ROOT')
	? Gio.File.new_for_path(GLib.getenv('COPYOUS_PREFS_ROOT')).get_path()
	: Gio.File.new_for_uri(import.meta.url)
			.get_parent()
			.get_parent()
			.get_parent()
			.get_path();
const SHELL_PREFS_GRESOURCE = '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource';

const dump = GLib.getenv('COPYOUS_PREFS_DUMP') === '1';
const results = [];
function chk(name, ok, detail) {
	results.push({ name, ok: ok === true, detail: ok === true ? '' : String(detail ?? '') });
}

function* walk(widget) {
	if (widget === null || widget === undefined) return;
	yield widget;
	let child = widget.get_first_child();
	while (child !== null) {
		yield* walk(child);
		child = child.get_next_sibling();
	}
}

// `Adw.Row` is not in the typelib; AdwPreferencesRow is the public base of every row type
// (Action/Switch/Combo/Spin/Entry/Expander/Button).
const isRow = (w) => w instanceof Adw.PreferencesRow;
const isGroup = (w) => w instanceof Adw.PreferencesGroup;
const isNested = (w) => w instanceof Adw.ExpanderRow;
const isSpinRow = (w) => w instanceof Adw.SpinRow;

// Rows that change a persisted value. Command rows ("Add Action", "Reset Actions"),
// status placeholders ("No Actions") and our own containers (NestedListBox) are not
// settings, and forcing a subtitle onto them would only teach the reader to ignore
// subtitles. Shortcut-capturing rows are found structurally, by the property they expose.
const SETTING_ROW_TYPES = [Adw.SwitchRow, Adw.ComboRow, Adw.SpinRow, Adw.EntryRow, Adw.PasswordEntryRow];
const isSettingRow = (w) => isRow(w) && (w.title ?? '') !== '' && (SETTING_ROW_TYPES.some((t) => w instanceof t) || 'shortcuts' in w);

// Icon-only buttons in the header bar are ours (the dependency warning), and Adw's own
// back button is not inside a row at all. So: a button counts when it sits inside a row,
// or when it is a menu button. Anything the toolkit draws for its own chrome is out.
// GtkMenuButton has no get_label(), so the text test only runs on real buttons.
const ourIconButton = (w) => {
	if (!(w instanceof Gtk.Button || w instanceof Gtk.MenuButton)) return false;
	if (w.get_icon_name() === null) return false;
	if (w instanceof Gtk.Button && (w.get_label() ?? '') !== '') return false;
	if (w instanceof Gtk.MenuButton) return true;
	return w.get_ancestor(Adw.PreferencesRow) !== null && !toolkitOwns(w);
};

// Steppers inside an AdwSpinRow and dropdown arrows are drawn by the toolkit itself; a
// tooltip there would be us labelling GTK's widgets, and `+`/`-` is not ambiguous.
const toolkitOwns = (b) => b.get_ancestor(Adw.SpinRow) !== null;

// The unit a reader scans is "a list of rows under one heading": a group, or the expander
// that opens it. Two rows are confusable only inside the same unit.
function ownerOf(row) {
	for (let w = row.get_parent(); w !== null; w = w.get_parent()) {
		if (isGroup(w) || isNested(w)) return w;
	}
	return null;
}

function pageName(row) {
	for (let w = row.get_parent(); w !== null; w = w.get_parent()) {
		if (w instanceof Adw.PreferencesPage) return w.title;
	}
	return '?';
}

async function build() {
	Gio.resources_register(Gio.resource_load(SHELL_PREFS_GRESOURCE));
	const {serializeExtension} = await import('resource:///org/gnome/Shell/Extensions/js/misc/extensionUtils.js');
	const {extensionManager} = await import('resource:///org/gnome/Shell/Extensions/js/extensionsService.js');
	const dir = Gio.File.new_for_path(ROOT);
	const [, bytes] = dir.get_child('metadata.json').load_contents(null);
	const metadata = JSON.parse(new TextDecoder().decode(bytes));
	const entry = extensionManager.createExtensionObject(
		serializeExtension({
			metadata,
			type: 2,
			state: 1,
			enabled: true,
			path: ROOT,
			hasPrefs: true,
			hasUpdate: false,
			canChange: true,
			sessionModes: ['user'],
		}),
	);
	const mod = await import(dir.get_child('prefs.js').get_uri());
	const prefsObj = new mod.default({ ...metadata, dir, path: ROOT });
	// gettext resolves through stateObj, which the real dialog also sets before filling.
	entry.stateObj = prefsObj;
	const win = new Adw.PreferencesWindow({ title: metadata.name, search_enabled: false });
	await prefsObj.fillPreferencesWindow(win);
	return win;
}

function report() {
	console.log('# results');
	let failed = 0;
	for (const r of results) {
		if (!r.ok) failed++;
		console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` = ${r.detail}` : ''}`);
	}
	console.log(`# ${results.length - failed}/${results.length} checks passed`);
	return failed;
}

const app = new Adw.Application({
	application_id: 'glitch.copyous.PrefsCheck',
	flags: Gio.ApplicationFlags.NON_UNIQUE,
});

// `activate` returns long before the async body does, and with no window presented the
// application would quit on its own with status 0 -- a dead instrument reporting green.
// The hold is what makes `finish()`'s exit code the script's exit code.
let held = false;
function finish(code) {
	if (held) {
		app.release();
		held = false;
	}
	// `Gio.Application` has no exit(code) -- only the private g_application_exit -- so the
	// status is set here rather than by quitting the application.
	System.exit(code);
}

app.connect('activate', () => {
	held = true;
	app.hold();
	(async () => {
		let win;
		try {
			win = await build();
			chk('windowBuilt', true);
		} catch (e) {
			chk('windowBuilt', false, `${e.message} :: ${(e.stack ?? '').split('\n').slice(0, 3).join(' / ')}`);
			report();
			finish(2);
			return;
		}

		const all = [...walk(win)];
		// Only the pages this extension added. `window.search_enabled` makes Adw build its
		// own untitled page (search results) inside the same NavigationView, and that chrome
		// is not ours to label -- counting it would report a defect we cannot fix.
		const ourPages = all.filter((w) => w instanceof Adw.PreferencesPage && (w.title ?? '') !== '');
		const ours = new Set();
		for (const page of ourPages) for (const w of walk(page)) ours.add(w);
		const groups = [...ours].filter(isGroup);
		const rows = [...ours].filter(isRow);
		const settingRows = rows.filter(isSettingRow);
		const buttons = [...ours].filter(ourIconButton);
		console.log(
			`# counts widgets=${all.length} ourPages=${ourPages.length} groups=${groups.length} rows=${rows.length} settingRows=${settingRows.length} iconOnlyButtons=${buttons.length}`,
		);

		// 1. A group with no title reads as debris: its rows look like a continuation of
		//    whatever group sits above them.
		const untitled = groups.filter((g) => (g.title ?? '') === '');
		chk(
			'everyGroupHasATitle',
			untitled.length === 0,
			`${untitled.length} untitled: ` +
					untitled.map((g) => `${pageName(g)}/${[...walk(g)].filter(isRow).length} rows`).join(' | '),
		);

		// 2. Every setting says what it changes, not only what it is called.
		const bare = settingRows.filter((r) => (r.subtitle ?? '') === '');
		chk(
			'everySettingRowHasASubtitle',
			bare.length === 0,
			`${bare.length}/${settingRows.length} bare: ` + bare.map((r) => `${pageName(r)}/${r.title}`).join(' | '),
		);

		// 3. An icon-only button has no text anywhere; the tooltip is its only label.
		const noTooltip = buttons.filter((b) => (b.tooltip_text ?? '') === '');
		chk(
			'everyIconOnlyButtonHasATooltip',
			noTooltip.length === 0,
			`${noTooltip.length}/${buttons.length} bare: ` +
				[...new Set(noTooltip.map((b) => b.get_icon_name()))].join(' | '),
		);

		// 4. Identical title+subtitle inside one list is ambiguous whether or not both are
		//    on screen: the pair that differs only in which code path shows it is the pair
		//    a reader (or a translator) cannot tell apart.
		const byOwner = new Map();
		for (const r of settingRows) {
			const o = ownerOf(r);
			if (o === null) continue;
			const key = `${pageName(r)}/${o.title ?? '(untitled)'}::${r.title}::${r.subtitle}`;
			byOwner.set(key, (byOwner.get(key) ?? 0) + 1);
		}
		const dupes = [...byOwner].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
		chk('noTwoSettingsShareTitleAndSubtitle', dupes.length === 0, dupes.join(' | '));

		if (dump) {
			console.log('# dump');
			for (const r of rows)
				console.log(
					`ROW\t${pageName(r)}\t${ownerOf(r)?.title ?? '?'}\t${r.constructor.name}\t${r.title}\t${r.subtitle ?? ''}`,
				);
			for (const g of groups) console.log(`GROUP\t${pageName(g)}\t${g.title ?? ''}\t${g.subtitle ?? ''}`);
			for (const b of buttons)
				console.log(
					`BUTTON\t${pageName(b)}\t${ownerOf(b)?.title ?? '?'}\t${b.get_icon_name()}\t${b.tooltip_text ?? ''}`,
				);
		}

		finish(report() === 0 ? 0 : 1);
	})().catch((e) => {
		// An exception that escapes the checks must never leave the script printing
		// nothing while exiting 0 -- that is how a broken instrument reads as green.
		chk('harnessDidNotThrow', false, `${e.message} :: ${(e.stack ?? '').split('\n').slice(0, 3).join(' / ')}`);
		report();
		finish(2);
	});
});

// GI_TYPELIB_PATH has to hold /usr/lib/gnome-shell/girepository-1.0 (Shew) *before* the
// first `gi://` import, so it is set by run.sh, not here.
app.run([]);
