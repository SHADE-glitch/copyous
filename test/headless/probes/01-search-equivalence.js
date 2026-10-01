// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 01: the entry-level filter must agree with the deleted
// per-item search() overrides, entry by entry, over a query matrix.
//
// The reference implementation below is transcribed verbatim from the per-type
// search() methods that used to live on the item classes (fileItem, filesItem,
// linkItem, imageItem, and the default text path). It is a copy on purpose: the
// point is to compare the shipped behaviour against what the code did BEFORE the
// filter moved to the entry layer, so sharing helpers with it would prove nothing.
//
// Compared over `_entries`, not over actors. Windowed, only a handful of entries
// have an actor at any moment, and a probe that walked the child list would have
// quietly shrunk from 255 comparisons to 7 -- the same assertion count, a tenth of
// the coverage, and no signal that anything was wrong.
(async () => {
	const co = globalThis.__co;
	const Gio = imports.gi.Gio;
	const GLib = imports.gi.GLib;
	const { cont, q, SearchChange } = await co.enable();

	const entries = cont._entries;
	const byType = {};
	for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1;
	co.rec('byType', byType);
	co.metric('entries', entries.length);

	// --- helpers the deleted overrides relied on ---
	const formatFile = (file) => {
		const relative = Gio.File.new_for_path(GLib.get_home_dir()).get_relative_path(file);
		return relative !== null ? `~/${relative}` : file.get_path() ?? file.get_uri();
	};
	const commonDirectory = (files) => {
		const parents = files.map((f) => f.get_parent()).filter((f) => f !== null);
		if (parents.length === 0) return null;
		return parents.reduce((common, file) => {
			if (common === null) return null;
			if (common.equal(file)) return common;
			while (common !== null && !file.has_prefix(common)) common = common.get_parent();
			return common;
		});
	};

	function oldTexts(entry) {
		switch (entry.type) {
			case 'Image':
				return [];
			case 'File': {
				const path = entry.content.substring('file://'.length);
				try {
					return [path, formatFile(Gio.File.new_for_uri(entry.content))];
				} catch {
					return [path];
				}
			}
			case 'Files': {
				let files;
				try {
					files = entry.content
						.split('\n')
						.map((f) => Gio.File.new_for_uri(f))
						.filter((f) => f.get_path() !== null);
				} catch {
					return [];
				}
				const common = commonDirectory(files);
				if (!common) return [];
				const texts = files.map((f) => f.get_path()?.toLowerCase() ?? '');
				if (formatFile(common).startsWith('~')) {
					for (const f of files) texts.push(formatFile(f).toLowerCase());
				}
				return texts;
			}
			case 'Link': {
				const m = { title: null, description: null, image: null, ...entry.metadata };
				const t = [entry.content];
				if (m.title) t.push(m.title);
				if (m.description) t.push(m.description);
				return t;
			}
			default:
				return [entry.content];
		}
	}

	const queries = [
		{ q: '' }, { q: 'a' }, { q: 'e' }, { q: 'the' }, { q: 'code' }, { q: 'import' },
		{ q: 'function' }, { q: '中文' }, { q: 'xyzqqq-no-match' }, { q: 'H.e' },
		{ q: 'cafe' }, { q: 'café' }, { q: '/' }, { q: '  ' }, { q: 'return' }, { q: 'home' },
		{ q: '', type: 'Code' }, { q: '', type: 'Text' }, { q: '', type: 'Image' },
		{ q: '', type: 'File' }, { q: '', type: 'Files' }, { q: '', type: 'Link' },
		{ q: 'a', type: 'Code' }, { q: '', pinned: true }, { q: '', excludePinned: true },
		{ q: 'e', excludePinned: true, type: 'Text' },
	];

	let compared = 0;
	const mismatches = [];
	const desync = [];
	const counts = {};
	for (const spec of queries) {
		const key =
			`${spec.q || '(empty)'}` +
			`${spec.type ? '|type=' + spec.type : ''}${spec.pinned ? '|pin' : ''}${spec.excludePinned ? '|exclPin' : ''}`;
		cont.search(q(SearchChange.Different, spec.q ?? '', spec));
		// A fresh query object per entry, because matchesEntry mutates nothing but the
		// reference must not share state with the container's own query.
		const ref = q(SearchChange.Different, spec.q ?? '', spec);
		let visible = 0;
		for (const entry of entries) {
			const got = cont._filterState.get(entry) ?? true;
			const want = ref.matchesEntry(true, entry, ...oldTexts(entry));
			compared++;
			if (got) visible++;
			if (got !== want && mismatches.length < 15)
				mismatches.push({ key, type: entry.type, got, want, content: entry.content.slice(0, 40) });
		}
		// Whatever has an actor must agree with the stored verdict.
		for (const [entry, item] of cont._items) {
			if (item.visible !== (cont._filterState.get(entry) ?? true) && desync.length < 5)
				desync.push({ key, type: entry.type, state: cont._filterState.get(entry), visible: item.visible });
		}
		counts[key] = visible;
	}
	co.rec('visibleCounts', counts);
	co.rec('mismatches', mismatches);
	co.rec('stateDesync', desync);
	co.metric('compared', compared);
	co.metric('materialized', cont._items.size);
	co.metric('windowed', cont._windowable());

	// --- incremental path: Same / LessStrict / MoreStrict against a reference that
	// keeps its own state array, exactly as the old code kept it in actor.visible ---
	const seq = ['e', 'el', 'ele', 'eleph', 'el', 'e', 'e', 'zzz', 'z', ''];
	const refState = entries.map(() => true);
	const incMismatch = [];
	let incCompared = 0;
	for (let k = 0; k < seq.length; k++) {
		const prevQ = k === 0 ? null : seq[k - 1];
		const cur = seq[k];
		const change =
			prevQ === null
				? SearchChange.Different
				: cur === prevQ
					? SearchChange.Same
					: cur.startsWith(prevQ)
						? SearchChange.MoreStrict
						: prevQ.startsWith(cur)
							? SearchChange.LessStrict
							: SearchChange.Different;
		cont.search(q(change, cur));
		const ref = q(change, cur);
		for (let i = 0; i < entries.length; i++) {
			const want = ref.matchesEntry(refState[i], entries[i], ...oldTexts(entries[i]));
			refState[i] = want;
			incCompared++;
			if ((cont._filterState.get(entries[i]) ?? true) !== want && incMismatch.length < 15)
				incMismatch.push({ step: k, change, q: cur, type: entries[i].type, got: cont._filterState.get(entries[i]), want });
		}
	}
	co.rec('incrementalMismatches', incMismatch);
	co.metric('incrementalCompared', incCompared);

	cont.search(q(SearchChange.Different, ''));
	co.chk('noMismatch', mismatches.length === 0);
	co.chk('noActorDesync', desync.length === 0);
	co.chk('noIncrementalMismatch', incMismatch.length === 0);
	co.chk('everyEntryCompared', compared === entries.length * queries.length);
	co.chk('allEntriesCoveredIncrementally', incCompared === entries.length * seq.length);
	co.done();
})().catch((e) => globalThis.__co.fail(e));
