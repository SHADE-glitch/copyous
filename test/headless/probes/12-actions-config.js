// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 12: an actions config that parses but is unusable must not
// take the item menu, the action shortcuts and the Actions page down with it.
//
// Why this is guarded at all. `loadConfig()` used to return whatever `JSON.parse` produced.
// Every consumer then does `config.actions.map(...)`, so a file holding `{}` -- written by
// hand, truncated by an interrupted save, or left by a version that stored something else --
// is indistinguishable from "the user deleted every action". The only symptoms were an empty
// item menu and two *unhandled promise rejections* in the journal, which is a print form that
// neither `CRITICAL` nor `JS ERROR` matches, so the regression gate could not see it at all.
//
// Four legs, in this order:
//   marker     write a one-action config of our own and wait until the menu shows its id.
//              This proves the file -> monitor -> updateActions pipeline is live *before* any
//              claim about recovery, and gives every later leg a value to leave behind.
//   provoke    replace the file with `{}` and wait for the menu to stop reporting the marker.
//              What it lands on is the verdict: an array (the guard fell back to defaults) or
//              "not-an-array" (the guard is missing and `.map` threw on `undefined`).
//   marker     write the same valid file again: a guard that always returned defaults would
//              pass leg 2 and fail here.
//   restore    put the original bytes back and wait for the menu to agree, so no later session
//              inherits this probe's damage -- which is how the last incident reached the live
//              session.
//
// The reload is driven by the extension's own Gio.FileMonitor, not by re-enabling: the same
// mechanism that produced the 18:02 journal lines, so the probe travels the real path.
(async () => {
	const co = globalThis.__co;
	const GLib = imports.gi.GLib;
	const Gio = imports.gi.Gio;

	const uuid = 'copyous@local';
	const write = (file, text) =>
		file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);

	await co.applyConfig();
	const Main = await import('resource:///org/gnome/shell/ui/main.js');
	const EM = Main.extensionManager;
	await EM._callExtensionInit(uuid);
	if (!EM.lookup(uuid)?.stateObj) throw new Error('extension never initialised');

	const path = Gio.File.new_build_filenamev([GLib.get_user_config_dir(), uuid, 'actions.json']);

	await EM._callExtensionEnable(uuid);
	for (let i = 0; i < 120; i++) {
		if (EM.lookup(uuid)?.stateObj?.clipboardDialog) break;
		await co.sleep(250);
	}
	const dialog = EM.lookup(uuid)?.stateObj?.clipboardDialog;
	if (!dialog) throw new Error('extension never enabled');

	const section = () => dialog._clipboardItemMenu?._actionMenuSection;
	const ids = () => {
		const actions = section()?._config?.actions;
		return Array.isArray(actions) ? actions.map((a) => a.id ?? a.name).join(',') : `not-an-array:${typeof actions}`;
	};

	co.chk('actionSectionReached', section() !== undefined, `section=${String(section())}`);

	// Read the file *after* enable: with no config on disk the extension writes the default
	// set itself (`loadConfig(ext, save=true)`), and a probe that hashed the absence before
	// the session started would have no oracle to compare against.
	const original = path.query_exists(null) ? new TextDecoder().decode(path.load_contents(null)[1]) : null;
	co.rec('configPath', path.get_path());

	// Every leg waits for a *change away from a marker it wrote itself*. Reading "is the
	// actions list still a list?" right after a write is worthless: the previous, perfectly
	// good value answers that question instantly, and the first version of this probe printed
	// a green 7/7 on code with the guard removed for exactly that reason.
	const idsOf = (text) => {
		try {
			const parsed = JSON.parse(text);
			return Array.isArray(parsed?.actions) ? parsed.actions.map((a) => a.id ?? a.name).join(',') : null;
		} catch {
			return null;
		}
	};
	const read = () => (path.query_exists(null) ? new TextDecoder().decode(path.load_contents(null)[1]) : null);
	const waitFor = async (predicate, ms = 12000) => {
		for (let i = 0; i < ms / 150; i++) {
			const now = ids();
			if (predicate(now)) return now;
			await co.sleep(150);
		}
		return ids();
	};
	const writeAndVerify = (text) => {
		write(path, text);
		return read() === text;
	};

	const SENTINEL = JSON.stringify({
		actions: [
			{ kind: 'command', id: 'probe12', name: 'Probe 12', types: ['Text'], command: 'true', output: 'ignore', shortcut: [] },
		],
		defaults: {},
	});

	// Leg 0 -- the pipeline is live: a valid custom file must actually reach the menu. Without
	// this the probe would measure a monitor that never fires and call it recovery.
	const sentinelWritten = writeAndVerify(SENTINEL);
	const reachedSentinel = await waitFor((v) => v === 'probe12');
	co.chk('sentinelReachedTheMenu', sentinelWritten && reachedSentinel === 'probe12' ? true : `file=${sentinelWritten} menu=${JSON.stringify(reachedSentinel)}`);

	// Leg 1 -- provoke: `{}` parses, so the old path reports no error; it just stops being a
	// list. Wait for the menu to leave the sentinel, then ask what it landed on.
	const brokenWritten = writeAndVerify('{}');
	const afterEmpty = await waitFor((v) => v !== 'probe12');
	co.chk('brokenFileWasWritten', brokenWritten ? true : 'replace_contents did not land');
	co.chk('emptyObjectDoesNotKillActions', !afterEmpty.startsWith('not-an-array') ? true : `after {} = ${afterEmpty}`);
	const recovered = section()?._config?.actions?.length ?? -1;
	co.metric('actionsAfterEmptyObject', recovered);
	co.metric('idsAfterEmptyObject', afterEmpty);
	co.chk('emptyObjectFallsBackToDefaults', recovered > 0 ? true : `actions=${recovered} ids=${JSON.stringify(afterEmpty)}`);

	// Leg 2 -- the fallback must not swallow real files: write the sentinel again and see it
	// come back through the same monitor.
	const againWritten = writeAndVerify(SENTINEL);
	const backToSentinel = await waitFor((v) => v === 'probe12');
	co.chk('validConfigIsHonouredAgain', againWritten && backToSentinel === 'probe12' ? true : `menu=${JSON.stringify(backToSentinel)}`);

	// Leg 3 -- leave the file exactly as found (or remove what this probe created), so no
	// later session inherits this probe's damage -- which is how the last incident reached
	// the live session.
	const expected = idsOf(original);
	co.chk('probeHasItsOwnOracle', original !== null && expected !== null && expected !== '' ? true : `original=${original === null ? 'absent' : JSON.stringify(expected)}`);
	if (original !== null) {
		writeAndVerify(original);
	} else if (path.query_exists(null)) {
		path.delete(null);
	}
	const restored = await waitFor((v) => v === expected);
	co.metric('restoredIds', restored);
	co.chk('configRestoredForLaterSessions', restored === expected ? true : `now=${JSON.stringify(restored)} file=${JSON.stringify(expected)}`);

	co.done();
})().catch((e) => globalThis.__co.fail(e));
