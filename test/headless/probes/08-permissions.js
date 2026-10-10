// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 08: what copyous stores is not readable by anyone else.
//
// What this guards. History is written verbatim -- every copied password, token and
// half-typed sentence. Measured on the live machine before the hardening existed: the
// app-data directory 0775, `clipboard.db`/`-wal`/`-shm` 0644, `images/` and `languages/`
// 0775 with files 0664, `~/.cache/copyous@local` 0775/0664, `~/.config/copyous@local`
// 0775 with `actions.json` 0664 (user-authored shell commands). The only thing keeping
// other principals out was `~/.local/share` itself being 0700 -- and `database-location`
// lets the store be moved somewhere with no such parent.
//
// It provokes instead of observing. The residue is *built* here, at the old modes, before
// the extension is enabled: nested directories, a file in each, and a symlink pointing out
// of the tree at a 0644 file that must stay 0644. So the run cannot pass because the
// fixture happened to be correct already, and the walk's symlink rule is covered by the
// only mechanism that can see it -- a file the sweep must not touch.
//
// One arm is enough; permissions do not depend on orientation or windowing. It is in
// ALL_PROBES so a regression cannot hide behind `run.sh all`.

(async () => {
	const co = globalThis.__co;
	const GLib = imports.gi.GLib;
	const Gio = imports.gi.Gio;

	const uuid = 'copyous@local';
	const mode = (file) => {
		if (!file.query_exists(null)) return null;
		const info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
		// Low 12 bits are the permission triple; the high bits are the file type.
		return info.get_attribute_uint32('unix::mode') & 0o7777;
	};
	const write = (file, text) =>
		file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
	const mkdir = (file) => {
		if (!file.query_exists(null)) file.make_directory_with_parents(null);
		return file;
	};

	const poisoned = [];
	const poison = (file, m) => {
		if (!file.query_exists(null)) return;
		if (GLib.chmod(file.get_path(), m) === 0) poisoned.push(`${m.toString(8)} ${file.get_basename()}`);
	};

	await co.applyConfig();

	const Main = await import('resource:///org/gnome/shell/ui/main.js');
	const EM = Main.extensionManager;
	await EM._callExtensionInit(uuid);
	if (!EM.lookup(uuid)?.stateObj) throw new Error('extension never initialised');

	// --- residue layout, exactly as it was left by a pre-hardening version -----------
	// Everything under the three roots the sweep is supposed to cover. `outside` sits in
	// XDG_DATA_HOME but *not* under `<uuid>`, so it is not the sweep's business.
	const data = mkdir(Gio.File.new_build_filenamev([GLib.get_user_data_dir(), uuid]));
	const cache = mkdir(Gio.File.new_build_filenamev([GLib.get_user_cache_dir(), uuid]));
	const config = mkdir(Gio.File.new_build_filenamev([GLib.get_user_config_dir(), uuid]));
	const outside = mkdir(Gio.File.new_build_filenamev([GLib.get_user_data_dir(), 'not-copyous']));
	const images = mkdir(data.get_child('images'));
	const languages = mkdir(data.get_child('languages'));
	const backup = mkdir(data.get_child('backup'));
	const nested = mkdir(backup.get_child('sub'));

	const themeCss = data.get_child('custom-theme.css');
	write(themeCss, 'css');
	const shot = images.get_child('shot.png');
	write(shot, 'png');
	const langJs = languages.get_child('js.min.js');
	write(langJs, 'js');
	const oldDb = backup.get_child('old.db');
	write(oldDb, 'db');
	const deep = nested.get_child('deep.txt');
	write(deep, 'txt');
	const thumb = cache.get_child('c220775d8e65acc132e0f0cc8a2472ec');
	write(thumb, 'jpg');
	const actions = config.get_child('actions.json');
	write(actions, '{}');

	// A link out of the tree. Enumerating without NOFOLLOW_SYMLINKS reports this as a
	// regular file, so a chmod on it lands on `secret` -- measured in a sandbox, where the
	// 0644 target was taken to 0600 by exactly that bug.
	const secret = outside.get_child('secret.txt');
	write(secret, 'secret');
	poison(secret, 0o644);
	const link = images.get_child('link-out');
	if (link.query_exists(null)) link.delete(null);
	// The receiver is the link to create; the argument is the target path.
	link.make_symbolic_link(secret.get_path(), null);

	for (const d of [data, cache, config, images, languages, backup, nested, outside]) poison(d, 0o775);
	for (const f of [themeCss, shot, langJs, oldDb, deep, thumb, actions]) poison(f, 0o644);

	// The database location is a fourth place, and under the harness it is not inside the
	// app-data directory at all -- up.sh points DEBUG_COPYOUS_DBPATH at $WORK/session.db.
	const env = GLib.get_environ();
	const debugPath = GLib.environ_getenv(env, 'DEBUG_COPYOUS_DBPATH');
	const db = debugPath
		? Gio.File.new_for_path(debugPath)
		: Gio.File.new_build_filenamev([GLib.get_user_data_dir(), uuid, 'clipboard.db']);
	const dbDir = db.get_parent();
	const wal = dbDir.get_child(`${db.get_basename()}-wal`);
	const shm = dbDir.get_child(`${db.get_basename()}-shm`);
	poison(dbDir, 0o775);
	poison(db, 0o644);
	poison(wal, 0o644);
	poison(shm, 0o644);

	co.rec('poisoned', poisoned);
	co.chk(
		'poisoningHappened',
		poisoned.length >= 12 ? true : `only ${poisoned.length} paths poisoned, expected at least 12`,
	);

	// --- enable ----------------------------------------------------------------------
	await EM._callExtensionEnable(uuid);
	for (let i = 0; i < 120; i++) {
		if (EM.lookup(uuid)?.stateObj?.clipboardDialog) break;
		await co.sleep(250);
	}
	if (!EM.lookup(uuid)?.stateObj?.clipboardDialog) throw new Error('extension never enabled');
	// SQLite creates -wal/-shm when `journal_mode=WAL` is applied; give it the chance.
	await co.sleep(600);

	// --- assert ----------------------------------------------------------------------
	const octal = (f) => {
		const m = mode(f);
		return m === null ? 'missing' : m.toString(8);
	};
	for (const [label, f] of [
		['dataDir', data],
		['cacheDir', cache],
		['configDir', config],
		['imagesDir', images],
		['languagesDir', languages],
		['backupDir', backup],
		['nestedDir', nested],
		['databaseDir', dbDir],
	]) {
		co.metric(label, octal(f));
		co.chk(`${label}Private`, mode(f) === 0o700);
	}
	for (const [label, f] of [
		['themeCss', themeCss],
		['imageFile', shot],
		['languageFile', langJs],
		['backupFile', oldDb],
		['nestedFile', deep],
		['cacheFile', thumb],
		['actionsFile', actions],
		['databaseFile', db],
	]) {
		co.metric(label, octal(f));
		co.chk(`${label}Private`, mode(f) === 0o600);
	}
	// A clean journal leaves no -wal/-shm behind, so only judge the ones that exist.
	for (const [label, f] of [['wal', wal], ['shm', shm]]) {
		if (f.query_exists(null)) {
			co.metric(`${label}Mode`, octal(f));
			co.chk(`${label}Private`, mode(f) === 0o600);
		} else {
			co.rec(label, 'absent (nothing to check)');
		}
	}

	// The sweep must not reach through links. If this ever goes red, the walk is chmodding
	// files that belong to something outside the extension's own directories.
	co.metric('symlinkTarget', octal(secret));
	co.chk('symlinkTargetUntouched', mode(secret) === 0o644);
	co.chk('outsideDirUntouched', mode(outside) === 0o775);

	co.done();
})().catch((e) => globalThis.__co.fail(e));
