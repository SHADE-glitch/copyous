// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — shared probe bootstrap.
//
// run.sh concatenates this file with a probe body into ONE Eval string and injects
//   globalThis.__coCfg  -- the settings object from configs/<name>.json
//   globalThis.__coOut  -- absolute path the probe must write its result JSON to
//
// ---------------------------------------------------------------------------
// Rules this file exists to enforce. Each one cost a wrong result before it was
// written down:
//
// 1. NEVER `await import('file:///<repo>/lib/...')` an extension module. That loads
//    a second copy of the module graph and re-registers its GTypes, and the
//    extension then dies on enable with
//    "Type name Gjs_common_gjs_JsObjectWrapper is already registered". Classes have
//    to be taken off live objects -- see `mk`/SearchQuery below.
// 2. `enable()` only schedules `_doEnable()` at PRIORITY_LOW idle. Polling
//    `stateObj` for truthiness is not enough; poll for `stateObj.clipboardDialog`.
// 3. GSETTINGS_BACKEND=memory is per-process, so settings must be written from
//    inside the shell, not from the calling script. Enum keys store the nick as a
//    string, hence set_value with a 's' variant rather than set_enum.
// 4. The database opens asynchronously *before* the first fill slice, so "child
//    count unchanged for a second" breaks out far too early and silently measures an
//    empty list. Poll the entry-list length, with a long cap.
// 5. Never read a property off an actor that has been destroyed -- not even
//    `get_parent()`. GJS logs a CRITICAL that a try/catch cannot suppress, which
//    makes the run look broken when only the probe was.
// ---------------------------------------------------------------------------

globalThis.__co = {
	out: { phase: 'pending', checks: {}, steps: {}, metrics: {} },

	rec(key, value) {
		this.out.steps[key] = value;
	},
	// A check records the *observed* value on failure, so verdict.js can print why.
	chk(key, value) {
		this.out.checks[key] = value === true ? true : value;
	},
	metric(key, value) {
		this.out.metrics[key] = value;
	},
	write() {
		imports.gi.GLib.file_set_contents(globalThis.__coOut, JSON.stringify(this.out, null, 1));
	},
	done() {
		this.out.phase = 'done';
		this.write();
	},
	// A probe whose subject is not active in this config must say so, not quietly
	// pass with zero checks.
	skip(reason) {
		this.out.phase = 'skipped';
		this.out.reason = reason;
		this.write();
	},
	fail(e) {
		this.out.phase = 'failed';
		this.out.err = `${e}\n${e.stack ?? ''}`;
		this.write();
	},

	sleep(ms) {
		const GLib = imports.gi.GLib;
		return new Promise((resolve) => {
			GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
				resolve();
				return GLib.SOURCE_REMOVE;
			});
		});
	},

	rssMB() {
		const GLib = imports.gi.GLib;
		const [ok, bytes] = GLib.file_get_contents('/proc/self/statm');
		if (!ok) return -1;
		// statm field 2 is resident pages.
		return Math.round((parseInt(imports.byteArray.toString(bytes).split(' ')[1]) * 4096) / 1048576);
	},

	ms() {
		return imports.gi.GLib.get_monotonic_time() / 1000;
	},

	async applyConfig() {
		const Gio = imports.gi.Gio;
		const GLib = imports.gi.GLib;
		const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.copyous' });
		for (const [key, value] of Object.entries(globalThis.__coCfg)) {
			// Keys beginning with '_' are documentation in the JSON, not settings.
			if (key.startsWith('_')) continue;
			if (typeof value === 'boolean') settings.set_boolean(key, value);
			else if (typeof value === 'number') settings.set_int(key, value);
			else settings.set_value(key, new GLib.Variant('s', value));
		}
		await this.sleep(300);
		return settings;
	},

	// Apply settings, enable the extension, wait for the fill to settle.
	// Returns the handles a probe needs, all taken from live objects.
	async enable() {
		const GLib = imports.gi.GLib;
		const St = imports.gi.St;
		const Main = await import('resource:///org/gnome/shell/ui/main.js');
		const EM = Main.extensionManager;
		const uuid = 'copyous@local';

		await this.applyConfig();
		const t0 = this.ms();
		await EM._callExtensionInit(uuid);
		await EM._callExtensionEnable(uuid);

		// Rule 2: _doEnable() is deferred to PRIORITY_LOW idle.
		for (let i = 0; i < 120; i++) {
			if (EM.lookup(uuid)?.stateObj?.clipboardDialog) break;
			await this.sleep(250);
		}
		const inst = EM.lookup(uuid)?.stateObj;
		const dlg = inst?.clipboardDialog;
		if (!dlg) throw new Error(`extension never enabled (state=${EM.lookup(uuid)?.state})`);

		const cont = dlg._scrollView._scrollContainer;
		// Rule 4: poll the entry list, not the child count -- windowed, the child
		// count is a single digit no matter how many entries have arrived.
		let prev = -1;
		let stable = 0;
		for (let i = 0; i < 240; i++) {
			const n = cont._entries.length;
			if (n === prev && n > 0) {
				if (++stable >= 8) break;
			} else {
				stable = 0;
				prev = n;
			}
			await this.sleep(250);
		}
		this.metric('entries', cont._entries.length);
		this.metric('fillMs', Math.round(this.ms() - t0));
		this.metric('rss', this.rssMB());

		// SearchQuery off a live instance (rule 1: no module import).
		const SQ = Object.getPrototypeOf(dlg._header.searchEntry.searchQuery).constructor;
		const SearchChange = { Same: 0, Different: 1, LessStrict: 2, MoreStrict: 3 };

		return {
			Main,
			St,
			GLib,
			inst,
			dlg,
			view: dlg._scrollView,
			cont,
			SQ,
			SearchChange,
			// A Different change forces a full re-evaluation, bypassing the
			// incremental Same/LessStrict/MoreStrict shortcuts.
			mk: (q) => new SQ(SearchChange.Different, q, false, false, null, false, null),
			// Full-arity query factory for probes that need type/pinned/tag filters.
			q: (change, text, o = {}) =>
				new SQ(
					change,
					text,
					o.pinned ?? false,
					o.excludePinned ?? false,
					o.tag ?? null,
					o.excludeTagged ?? false,
					o.type ?? null,
				),
			// Visible item children only: unwindowed, a search hides non-matching
			// actors rather than removing them, so "children mirror _filtered" has to
			// mean the visible ones.
			itemChildren: () => cont.get_children().filter((c) => c.entry?.content !== undefined && c.visible),
			focusedEntry: () => {
				for (const [e, it] of cont._items) if (it.has_key_focus()) return e;
				return null;
			},
		};
	},
};
