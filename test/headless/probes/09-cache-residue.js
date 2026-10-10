// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 09: disabling copyous releases the search memo table.
//
// Why this needs a guard at all. `localeContains()` memoizes per (query, text) pair and
// the *inner keys are whole, untruncated clipboard contents*. While that map lived at
// module scope, GJS kept it alive for the entire shell session -- so every text that was
// ever filtered stayed strongly reachable after `disable()`, including entries the user
// deleted and entries the history limit had trimmed away. A "leaked 300KB" line in a
// memory report is not what makes that a defect: the data is plaintext clipboard history.
//
// What this proves, and what it cannot.
//   * Provable (deterministic): the table is owned by the SearchEntry instance -- a second
//     instance built from the same live class starts empty and does not share the map.
//     Under a module-level cache both checks go red because the instance owns nothing
//     (`_matchCache` is `undefined`), which is exactly the shape the defect had.
//   * Provable: `disable()` releases the dialog, so nothing reachable from the extension
//     object still points at the entry that owns the table.
//   * Not provable here: that the collector reclaimed the memory promptly. GJS gives no
//     deterministic reclaim point, so RSS around the disable is reported as a number and
//     is *not* a check -- same policy as probe 05's cost figures (docs/maintenance/reading-the-log.md).
//
// A full disable/re-enable cycle is deliberately *not* attempted: the harness enables via
// `_callExtensionInit`/`_callExtensionEnable` without going through the extension manager's
// state, so a second enable conflicts on the status-indicator extension point. That is a
// property of the harness, not of the extension -- and the instance-identity check above
// has the same discriminating power without it.

(async () => {
	const co = globalThis.__co;
	const h = await co.enable();

	// Fill the table through the same path the UI uses: the container's search, driven by
	// a query built from the live SearchQuery class.
	h.cont.search(h.mk('e'));
	const cache1 = h.searchEntry?._matchCache;
	co.chk(
		'cacheIsOwnedByTheInstance',
		cache1 instanceof Map ? true : `searchEntry._matchCache is ${typeof cache1} -- a module-level table is back`,
	);
	co.chk('searchPopulatedTheTable', cache1 && cache1.size >= 1 ? true : `size=${cache1?.size}`);

	let texts1 = 0;
	if (cache1) for (const byText of cache1.values()) texts1 += byText.size;
	co.metric('queriesCachedAtDisable', cache1?.size ?? -1);
	co.metric('entryTextsRetainedAtDisable', texts1);
	co.metric('rssBeforeDisable', co.rssMB());
	co.chk(
		'searchActuallyMemoizedTexts',
		texts1 >= 10 ? true : `only ${texts1} texts were memoized, fixture is not being searched`,
	);

	// A second instance from the same live class (rule 1: the class comes off the object,
	// never off an import) must bring its own empty table.
	const SearchEntryClass = Object.getPrototypeOf(h.searchEntry).constructor;
	const se2 = new SearchEntryClass(h.inst);
	co.chk(
		'freshInstanceStartsEmpty',
		se2._matchCache instanceof Map && se2._matchCache.size === 0
			? true
			: `new SearchEntry came up with ${se2._matchCache?.size} cached queries`,
	);
	co.chk('tablesAreNotShared', se2._matchCache !== cache1 ? true : 'two SearchEntry instances share one Map');
	se2.destroy();

	// --- disable ----------------------------------------------------------------------
	h.inst.disable();
	co.chk(
		'disableReleasedTheDialog',
		h.inst.clipboardDialog === undefined ? true : `clipboardDialog is still ${typeof h.inst.clipboardDialog}`,
	);
	// Best effort: give the collector a chance so the RSS number below means something.
	// Nothing is asserted about it -- see the header.
	imports.system?.gc?.();
	await co.sleep(1000);
	co.metric('rssAfterDisableAndGc', co.rssMB());

	co.done();
})().catch((e) => globalThis.__co.fail(e));
