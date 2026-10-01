// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 02: modal balance across normal and interrupted closes,
// search-driven navigation, and the no-match placeholder.
//
// The modal checks are the reason this probe exists. `Main.popModal()` returns early
// while `modalCount > 0`, so a close whose 150ms animation is replaced by a reopen
// used to skip popModal entirely and leave the counter stuck for the rest of the
// session -- which in turn skips layoutManager.modalEnded(), enable_unredirect() and
// the actionMode restore. Clutter never runs the onComplete of a transition it
// replaced, so nothing else would ever notice.
(async () => {
	const co = globalThis.__co;
	const { Main, St, dlg, view, cont, mk } = await co.enable();

	const stack = () => Main.modalActorFocusStack?.length;
	const items = () => cont.get_children().filter((c) => c.entry?.content !== undefined);
	const visItems = () => items().filter((c) => c.visible);
	const focusedChild = () => cont.get_children().find((c) => c.has_key_focus?.());

	co.metric('windowable', cont._windowable());
	co.metric('entries', cont._entries.length);
	co.metric('materialized', cont._items.size);

	// ---- modal balance: open, close, and reopen inside the close animation ----
	dlg.open();
	await co.sleep(500);
	co.chk('openTakesModal', stack() === 1 && dlg.opened === true);

	dlg.close();
	await co.sleep(600);
	co.chk('closeReleasesModal', stack() === 0 && dlg._grab === null && dlg.opened === false);

	dlg.open();
	await co.sleep(400);
	dlg.close();
	await co.sleep(30);
	co.chk('closeAnimationInFlight', dlg._closing === true && stack() === 1);

	dlg.open();
	co.chk('reopenInsideAnimation', dlg.opened === true && dlg._closing === false && stack() === 1);
	await co.sleep(500);
	dlg.close();
	await co.sleep(600);
	co.chk('interruptedCycleReleasesModal', stack() === 0 && dlg._grab === null);

	for (let i = 0; i < 4; i++) {
		dlg.open();
		await co.sleep(60);
		dlg.close();
		await co.sleep(25);
		dlg.open();
		await co.sleep(60);
		dlg.close();
		await co.sleep(400);
	}
	co.chk('noModalAccumulation', stack() === 0);
	co.chk('itemsSurviveQuickCycles', items().length === cont._items.size && cont._items.size > 0);

	// ---- search then navigate by index ----
	dlg.open();
	await co.sleep(400);
	cont.search(mk('e'));
	await co.sleep(250);
	co.chk('searchNarrows', cont._filtered.length < cont._entries.length && cont._filtered.length > 0);

	const matched = view.selectItem(2);
	await co.sleep(200);
	co.chk('selectItemReturnsTrue', matched === true);
	co.chk('selectItemFocusesThirdMatch', visItems().indexOf(focusedChild()) === 2);
	co.chk('focusedItemIsVisible', focusedChild()?.visible === true);

	view.selectItem(0);
	await co.sleep(200);
	co.chk('selectItem0IsTop', visItems().indexOf(focusedChild()) === 0);

	view.selectNextItem();
	await co.sleep(200);
	co.chk('selectNextItemMovesOne', visItems().indexOf(focusedChild()) === 1);

	// ---- no-match leaves exactly the status placeholder ----
	cont.search(mk('zzz-no-such-text'));
	await co.sleep(300);
	co.chk('noMatchHasNoVisibleItem', visItems().length === 0);
	co.chk('noMatchShowsPlaceholder', cont._statusItem.get_parent() === cont);
	// State.NoResults is 1 (lib/ui/items/statusItem.js). Compared as a literal because
	// importing that module by file:// URI would re-register its GTypes.
	co.chk('noMatchStateIsNoResults', cont._statusItem.state === 1);

	// ---- clearing restores everything ----
	cont.search(mk(''));
	await co.sleep(350);
	co.chk('clearRestoresAllMaterialized', visItems().length === cont._items.size);
	co.chk('clearRestoresFilter', cont._filtered.length === cont._entries.filter((e) => cont._filterState.get(e)).length);
	co.chk('placeholderRemoved', cont._statusItem.get_parent() !== cont);

	dlg.close();
	await co.sleep(600);
	co.chk('finalModalReleased', stack() === 0 && dlg.opened === false);
	co.metric('materializedAfterClear', cont._items.size);
	co.done();
})().catch((e) => globalThis.__co.fail(e));
