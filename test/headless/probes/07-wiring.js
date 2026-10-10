// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 07: caller/wiring consistency, resolved against live objects.
//
// Why this exists instead of a grep. The maintenance handbook used to prescribe
//
//   grep -rn "\.addItem(\|\.focusChild(\|\.nextFocus(" . | grep -v test/
//
// as the check to run after deleting a container method. Two things were wrong with it:
// the container refactor deleted `addItem` while `SearchEntry` keeps an unrelated private
// `addItem()` for its type-filter popup, so the check printed 9 false hits forever (and a
// permanently-red check is either ignored or "fixed" by deleting working code); and a list
// of *deleted* names rots the moment someone legitimately reintroduces one.
//
// What this does instead: receivers are derived from the source itself — `this._x = new
// Cls(...)` plus `this._x.method(...)` in the same file — and `method` is resolved against
// a **live instance** of `Cls`, so inherited St/Clutter/GObject API resolves correctly and
// needs no allowlist. Classes with no live instance are reported as skipped, not silently
// passed. No name table, nothing to maintain.
//
// The object walk only descends into classes *declared in this repo* (parsed from the same
// sources). That is not tidiness: an unrestricted walk died here with
// `Unsupported type GdaShort, deriving from fundamental gint`, because reading a property
// off a GI boxed/struct object makes GJS marshal a GValue it cannot represent. It also
// keeps the walk off any actor that might already be disposed — rule 5 of the preamble.
//
// Known limit, stated rather than hidden: a call whose receiver is not assigned with
// `new <Class>(` in the same file (a parameter, a module singleton, a returned object) is
// invisible here. Those still fail loudly at runtime as `is not a function`, which lands in
// JS ERROR and is caught by run.sh's log gate. Prefs-side classes are never instantiated in
// the shell process, so they are always in the skipped set — the prefs process is separate.

(async () => {
	const co = globalThis.__co;
	const GLib = imports.gi.GLib;
	const Gio = imports.gi.Gio;

	const h = await co.enable();
	const inst = h.inst;
	const root = inst.dir.get_path();

	// --- 1. every runtime source, read off disk -------------------------------
	const sources = {};
	const walk = (dir, depth) => {
		if (depth > 4) return;
		const e = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
		let info;
		while ((info = e.next_file(null))) {
			const name = info.get_name();
			if (name.startsWith('.')) continue;
			const child = dir.get_child(name);
			if (info.get_file_type() === Gio.FileType.DIRECTORY) walk(child, depth + 1);
			else if (name.endsWith('.js')) {
				const [ok, bytes] = GLib.file_get_contents(child.get_path());
				if (ok) sources[child.get_path()] = imports.byteArray.toString(bytes);
			}
		}
	};
	walk(Gio.File.new_for_path(`${root}/lib`), 0);
	const [okExt, extBytes] = GLib.file_get_contents(`${root}/extension.js`);
	if (okExt) sources[`${root}/extension.js`] = imports.byteArray.toString(extBytes);

	co.metric('filesRead', Object.keys(sources).length);
	// A wiring check that read nothing would pass by inspecting nothing.
	co.chk('sourcesReadable', Object.keys(sources).length >= 60 ? true : `only ${Object.keys(sources).length} runtime files`);

	// --- 2. the universe: classes this repo declares, and receivers it builds --
	const repoClasses = new Set();
	for (const text of Object.values(sources))
		for (const m of text.matchAll(/(?:^|\s)(?:class|let|const|var)\s+([A-Z][A-Za-z0-9]*)\s*(?:=\s*class)?\s*(?:extends\s+[A-Za-z0-9_.]+\s*)?\{/g))
			repoClasses.add(m[1]);
	co.metric('declaredClasses', repoClasses.size);

	const ASSIGNED = /this\.([_A-Za-z0-9]+)\s*=\s*new\s+([A-Z][A-Za-z0-9]*)\s*\(/g;
	const CALLED = /this\.([_A-Za-z0-9]+)\.([a-zA-Z_][A-Za-z0-9_]*)\s*\(/g;
	const pairs = [];
	for (const [path, text] of Object.entries(sources)) {
		const byField = new Map();
		for (const m of text.matchAll(ASSIGNED)) {
			if (!repoClasses.has(m[2])) continue;
			if (!byField.has(m[1])) byField.set(m[1], new Set());
			byField.get(m[1]).add(m[2]);
		}
		for (const m of text.matchAll(CALLED)) {
			const classes = byField.get(m[1]);
			if (!classes) continue;
			pairs.push({ file: path.slice(root.length + 1), field: m[1], method: m[2], classes: [...classes] });
		}
	}
	co.metric('pairsFound', pairs.length);
	co.chk('pairsFoundNonZero', pairs.length > 0);

	// --- 3. live instances, reached only through repo classes ------------------
	// Seeded from the extension *and* from one materialized item of every type the
	// history actually holds: the item classes (CodeLabel, ImagePreview, FilePreview,
	// …) are where a leftover caller hurts most, and viewport windowing keeps only a
	// handful of actors alive at a time, so an unfiltered fill would show Text only.
	const nameOf = (o) => o?.constructor?.name ?? null;
	const live = new Map();
	const seen = new Set([inst]);
	const queue = [[inst, 0]];

	const seedItems = () => {
		for (const item of h.cont._items.values()) {
			if (item && !seen.has(item)) {
				seen.add(item);
				queue.push([item, 0]);
			}
		}
	};
	const types = [...new Set([...h.cont._entries].map((e) => e.type))];
	for (const t of types) {
		h.cont.search(h.q(1, '', { type: t }));
		await co.sleep(250);
		seedItems();
	}
	h.cont.search(h.q(1, '', {}));
	await co.sleep(250);
	seedItems();
	co.metric('itemTypesSeen', types.length);
	while (queue.length) {
		const [obj, depth] = queue.shift();
		const n = nameOf(obj);
		if (n && !live.has(n)) live.set(n, obj);
		if (depth >= 4) continue;
		for (const k of Object.keys(obj)) {
			const v = obj[k];
			if (!v || typeof v !== 'object' || seen.has(v)) continue;
			// Descend only into this repo's own classes: GI boxed types throw on
			// property read, and a foreign actor may already be disposed.
			const vn = nameOf(v);
			if (!vn || !repoClasses.has(vn)) continue;
			seen.add(v);
			queue.push([v, depth + 1]);
		}
	}
	co.metric('liveClasses', live.size);

	// --- 4. resolve -------------------------------------------------------------
	const resolve = (list) => {
		const failures = [];
		const skipped = new Set();
		for (const { file, field, method, classes } of list) {
			const candidates = classes.filter((c) => live.has(c));
			if (candidates.length === 0) {
				skipped.add(classes.join('|'));
				continue;
			}
			// Fail only when NO candidate provides it: several fields legitimately hold
			// different classes (`_database` = GdaDatabase | JsonDatabase | MemoryDatabase).
			if (!candidates.some((c) => typeof live.get(c)[method] === 'function'))
				failures.push(`${file}: this.${field}.${method}() — no live ${candidates.join('/')} declares it`);
		}
		return { failures, skipped: [...skipped] };
	};
	const { failures, skipped } = resolve(pairs);
	co.metric('skippedClassSets', skipped.length);
	co.chk('noUnresolvableCalls', failures.length === 0 ? true : failures.slice(0, 8));

	// --- 5. provoke the detector --------------------------------------------------
	// Without this the check could still pass by resolving nothing. Same code path,
	// synthetic input: one name the container really has, one it never had.
	const st = resolve([
		{ file: '<selftest>', field: '_scrollContainer', method: 'addEntry', classes: ['ClipboardScrollContainer'] },
		{ file: '<selftest>', field: '_scrollContainer', method: 'addItemThatWasDeleted', classes: ['ClipboardScrollContainer'] },
	]);
	co.chk('selfTestPassesRealMethod', st.failures.length === 1 ? true : `expected exactly 1 failure, got ${st.failures.length}`);
	co.chk('selfTestCatchesGhostMethod', st.failures.some((f) => f.includes('addItemThatWasDeleted')));
	co.chk('containerLive', live.has('ClipboardScrollContainer'));
	co.rec('skippedSets', skipped);
	co.rec('liveClassNames', [...live.keys()]);

	co.done();
})().catch((e) => globalThis.__co.fail(e));
