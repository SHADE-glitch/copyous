// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 04: viewport windowing.
//
// Skipped when the config makes item size non-uniform, because then _materialized()
// deliberately returns the whole list and there is nothing here to test.
//
// The central claim is that the two spacers make the scroll extent identical to the
// full list's. That is checked by A/B inside one session with identical settings:
// force the window to cover everything, measure, restore, measure. The only variable
// is how many actors exist.
//
// Tolerance is arm-specific and deliberate. A vertical list measures exact (the theme's
// `:first-child` margin-top is 0 while show-header is on). A horizontal list is off by
// 15px per list end that sits outside the window, because `.clipboard-item:first-child
// { margin-left: 15px }` only applies to the item that actually carries the pseudoclass.
// That deviation is known and accepted (README.zh-CN.md); encoding it as a bound keeps
// the probe honest -- if it grows, this goes red.
(async () => {
	const co = globalThis.__co;
	const { Main, St, GLib, dlg, view, cont, mk, itemChildren, focusedEntry } = await co.enable();

	if (!cont._windowable()) return co.skip('item size is not uniform in this config; windowing inactive');

	// Clutter.Orientation.VERTICAL is 1. Compared as a literal rather than imported so
	// this file stays free of any module import (see the preamble's rule 1).
	const vertical = cont.orientation === 1;
	const tolerance = vertical ? 0 : 30;
	co.metric('tolerancePx', tolerance);
	co.metric('perItem', cont._perItem());

	dlg.open();
	await co.sleep(900);
	cont.cancelProgressiveReveal();
	await co.sleep(300);

	const adj = () => cont._axisAdjustment();
	co.metric('pageSize', Math.round(adj().page_size));
	co.metric('materialized', cont._items.size);
	co.chk('residentSetBelowList', cont._items.size < cont._filtered.length);

	// ---- extent A/B: the scroll range must not depend on how many actors exist ----
	const windowed = { upper: Math.round(adj().upper), materialized: cont._items.size };
	cont._materialized = () => ({ list: cont._entries, lo: 0, hi: cont._entries.length });
	cont._syncWindow(true);
	await co.sleep(2500);
	const full = { upper: Math.round(adj().upper), materialized: cont._items.size, rss: co.rssMB() };
	delete cont._materialized;
	cont._syncWindow(true);
	await co.sleep(2500);
	co.rec('extentAB', { windowed, full, backTo: Math.round(adj().upper) });
	co.chk('extentMatchesFullList', Math.abs(windowed.upper - full.upper) <= tolerance);
	co.chk('fullArmReallyMaterializedEverything', full.materialized === cont._entries.length);
	co.chk('restoredToWindow', cont._items.size === windowed.materialized);
	co.metric('rssFullMB', full.rss);
	co.metric('rssWindowedMB', co.rssMB());

	// ---- scrolling: order aligned with _filtered, extent stable ----
	const uppers = [];
	const misaligned = [];
	const wins = [];
	for (const frac of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
		const max = Math.max(0, adj().upper - adj().page_size);
		adj().value = Math.round(frac * max);
		await co.sleep(350);
		const kids = itemChildren();
		const lo = cont._winLo;
		uppers.push(Math.round(adj().upper));
		wins.push([cont._winLo, cont._winHi]);
		if (kids.length !== cont._winHi - cont._winLo || !kids.every((k, i) => k.entry === cont._filtered[lo + i]))
			misaligned.push({ frac, kids: kids.length, win: [cont._winLo, cont._winHi] });
	}
	co.rec('scrollMisaligned', misaligned);
	co.chk('scrollKeepsOrder', misaligned.length === 0);
	co.chk('scrollExtentStable', Math.max(...uppers) - Math.min(...uppers) <= tolerance);

	// ---- focusing an entry outside the window materializes it ----
	adj().value = 0;
	await co.sleep(400);
	const far = cont._filtered[cont._filtered.length - 3];
	cont.focusEntry(far, false);
	await co.sleep(500);
	co.chk('focusFarMaterializes', cont._items.has(far));
	co.chk('focusFarTakesFocus', focusedEntry() === far);
	co.chk('focusFarScrollsIntoWindow', cont._filtered.indexOf(far) >= cont._winLo && cont._filtered.indexOf(far) < cont._winHi);

	// ---- scrolling away releases key focus but keeps the remembered entry ----
	const remembered = cont._focusEntry;
	adj().value = 0;
	await co.sleep(500);
	co.chk('scrollAwayRemembers', cont._focusEntry === remembered);
	co.chk('scrollAwayReleasesKeyFocus', focusedEntry() === null);
	co.chk('scrollAwayDropsTheActor', !cont._items.has(remembered));

	cont.vfunc_navigate_focus(null, St.DirectionType.DOWN);
	await co.sleep(500);
	co.chk('navigateRestoresRememberedEntry', focusedEntry() === remembered);
	co.chk('restoreRebuildsActor', cont._items.has(remembered));

	// ---- Home / End reach entries that have no actor yet ----
	view.selectItem(0);
	await co.sleep(300);
	cont.focusFirstFiltered();
	await co.sleep(300);
	co.chk('homeFocusesFirst', focusedEntry() === cont._filtered[0]);
	cont.focusLastFiltered();
	await co.sleep(400);
	co.chk('endFocusesLast', focusedEntry() === cont._filtered[cont._filtered.length - 1]);

	// ---- search windows over the filtered list ----
	cont.search(mk('e'));
	await co.sleep(700);
	co.chk('searchWindowsOverFiltered', itemChildren().every((k) => cont._filtered.includes(k.entry)));
	co.chk('searchAllChildrenMatch', itemChildren().every((k) => cont._filterState.get(k.entry) === true));
	co.chk('searchStillWindowed', cont._items.size < cont._filtered.length);

	cont.search(mk('zzz-no-match'));
	await co.sleep(400);
	co.chk('noMatchMaterializesNothing', cont._items.size === 0);
	co.chk('noMatchShowsPlaceholder', cont._statusItem.get_parent() === cont);

	cont.search(mk(''));
	await co.sleep(500);
	co.chk('clearRestoresWindow', cont._items.size > 0 && cont._items.size < cont._filtered.length);

	// ---- delete and re-sort keep the window consistent ----
	const victim = cont._entries[Math.min(3, cont._entries.length - 1)];
	const nBefore = cont._entries.length;
	victim.emit('delete');
	await co.sleep(600);
	co.chk('deleteWhileWindowed', !cont._entrySet.has(victim) && nBefore - cont._entries.length === 1);
	co.chk('deleteKeepsOrder', itemChildren().every((k, i) => k.entry === cont._filtered[cont._winLo + i]));

	const mover = cont._entries[Math.min(10, cont._entries.length - 1)];
	const oldDt = mover.datetime;
	mover.datetime = GLib.DateTime.new_now_utc();
	await co.sleep(600);
	co.chk('resortWhileWindowed', cont._entries[0] === mover);
	co.chk('resortKeepsOrder', itemChildren().every((k, i) => k.entry === cont._filtered[cont._winLo + i]));
	mover.datetime = oldDt;
	await co.sleep(400);

	dlg.close();
	await co.sleep(700);
	co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
	co.done();
})().catch((e) => globalThis.__co.fail(e));
