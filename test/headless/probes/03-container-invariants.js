// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 03: the entry list is the source of truth and the actors
// mirror exactly the slice of it that is supposed to have them.
//
// `expectedChildren()` is the whole point of this file. Unwindowed, the mirror is the
// whole filtered list carried by `visible`; windowed, it is `_filtered[_winLo.._winHi)`.
// Asserting one fixed shape would make this probe lie in the other arm.
(async () => {
	const co = globalThis.__co;
	const { Main, St, GLib, dlg, view, cont, mk, itemChildren, focusedEntry } = await co.enable();

	const windowed = cont._windowable();
	co.metric('windowable', windowed);

	// The children that must exist right now, in order.
	const expectedChildren = () => (windowed ? cont._filtered.slice(cont._winLo, cont._winHi) : cont._filtered);
	const childrenMirror = () => {
		const kids = itemChildren();
		const want = expectedChildren();
		if (kids.length !== want.length) return `length ${kids.length} != ${want.length}`;
		for (let i = 0; i < kids.length; i++) if (kids[i].entry !== want[i]) return `index ${i} differs`;
		return true;
	};

	co.chk('fillArrived', cont._entries.length > 100);
	co.rec('counts', {
		entries: cont._entries.length,
		filtered: cont._filtered.length,
		materialized: cont._items.size,
		window: [cont._winLo, cont._winHi],
	});

	// ---- display order: newest first, ties by ascending id ----
	let orderBad = -1;
	for (let i = 1; i < cont._entries.length; i++) {
		if (cont._before(cont._entries[i], cont._entries[i - 1])) {
			orderBad = i;
			break;
		}
	}
	co.chk('entriesSorted', orderBad === -1);
	co.chk('childrenMirrorAtRest', childrenMirror() === true);
	if (childrenMirror() !== true) co.rec('childrenMirrorAtRest.why', childrenMirror());

	// ---- Home / End target the ends of the filtered list, not the child list ----
	dlg.open();
	await co.sleep(600);
	cont.cancelProgressiveReveal();
	await co.sleep(200);
	cont.focusFirstFiltered();
	await co.sleep(250);
	co.chk('homeFocusesFirst', focusedEntry() === cont._filtered[0]);
	cont.focusLastFiltered();
	await co.sleep(300);
	co.chk('endFocusesLast', focusedEntry() === cont._filtered[cont._filtered.length - 1]);
	co.chk('endIsMaterialized', cont._items.has(cont._filtered[cont._filtered.length - 1]));

	// ---- TAB walks the filtered list and crosses the window boundary ----
	cont.focusFirstFiltered();
	await co.sleep(250);
	cont.vfunc_navigate_focus(cont._items.get(cont._filtered[0]), St.DirectionType.TAB_FORWARD);
	await co.sleep(200);
	co.chk('tabForwardToSecond', focusedEntry() === cont._filtered[1]);
	cont.vfunc_navigate_focus(cont._items.get(cont._filtered[1]), St.DirectionType.TAB_BACKWARD);
	await co.sleep(200);
	co.chk('tabBackwardToFirst', focusedEntry() === cont._filtered[0]);

	let walkOk = true;
	const walkN = Math.min(25, cont._filtered.length - 1);
	for (let i = 1; i <= walkN; i++) {
		const from = cont._items.get(cont._filtered[i - 1]);
		if (!from) {
			walkOk = `no actor at ${i - 1}`;
			break;
		}
		cont.vfunc_navigate_focus(from, St.DirectionType.TAB_FORWARD);
		await co.sleep(110);
		if (focusedEntry() !== cont._filtered[i]) {
			walkOk = `stopped at ${i} (got ${cont._filtered.indexOf(focusedEntry())})`;
			break;
		}
	}
	co.chk('arrowWalkAcrossWindow', walkOk === true);
	if (walkOk !== true) co.rec('arrowWalk.stopped', walkOk);

	// ---- search narrows the mirror ----
	cont.search(mk('e'));
	await co.sleep(350);
	co.chk('searchNarrows', cont._filtered.length < cont._entries.length && cont._filtered.length > 0);
	co.chk('searchKeepsMirror', childrenMirror() === true);
	co.chk('searchHidesNonMatches', itemChildren().every((k) => cont._filterState.get(k.entry) === true));

	cont.search(mk('zzz-no-match'));
	await co.sleep(300);
	co.chk('noMatchEmptiesMirror', itemChildren().length === 0);
	cont.search(mk(''));
	await co.sleep(350);
	co.chk('clearRestoresMirror', childrenMirror() === true);

	// ---- an entry that stops matching while focused hands focus to the next match ----
	// Drives _refilterEntry() (the notify::content path) without touching the database:
	// the verdict is forced for that one entry, everything else uses the real filter.
	cont.search(mk('e'));
	await co.sleep(300);
	const losing = cont._filtered[5];
	cont.focusEntry(losing, false);
	await co.sleep(200);
	const realApply = cont._applyFilterEntry.bind(cont);
	cont._applyFilterEntry = (entry, query) =>
		entry === losing ? (cont._filterState.set(entry, false), false) : realApply(entry, query);
	cont._refilterEntry(losing);
	delete cont._applyFilterEntry;
	await co.sleep(300);
	// Index 5 now holds what was index 6 -- the next match, which is where the old
	// next-visible-sibling walk put focus.
	co.chk('refilterHandsOffToNextMatch', focusedEntry() === cont._filtered[5]);
	co.chk('refilterDropsFromFiltered', !cont._filtered.includes(losing));
	cont.search(mk(''));
	await co.sleep(350);

	// ---- a live copy while the dialog is open becomes the first, focused entry ----
	// registerEntry() is the exact call extension.js makes from the manager's
	// 'clipboard' signal. copyText() is NOT a substitute: it only emits 'text', which
	// drives the indicator and never creates an entry. Going through the database would
	// trip the history-length prune and mutate the fixture.
	const fresh = cont._entries[Math.min(20, cont._entries.length - 1)];
	const freshDt = fresh.datetime;
	cont.removeEntry(fresh);
	fresh.datetime = GLib.DateTime.new_now_utc();
	await co.sleep(300);
	const beforeAdd = cont._entries.length;
	dlg.registerEntry(fresh);
	await co.sleep(600);
	co.chk('liveCopyAppends', cont._entries.length - beforeAdd === 1);
	co.chk('liveCopyIsFirst', cont._entries[0] === fresh);
	co.chk('liveCopyMaterialized', cont._items.has(fresh));
	co.chk('liveCopyTakesFocus', focusedEntry() === fresh);
	co.chk('liveCopyKeepsMirror', childrenMirror() === true);
	fresh.datetime = freshDt;
	await co.sleep(400);

	// ---- delete removes it from the list and drops its actor ----
	const victim = cont._entries[3];
	const nBefore = cont._entries.length;
	victim.emit('delete');
	await co.sleep(500);
	co.chk('deleteRemovesEntry', !cont._entrySet.has(victim) && nBefore - cont._entries.length === 1);
	co.chk('deleteDestroysActor', cont._items.get(victim) === undefined);
	co.chk('deleteKeepsMirror', childrenMirror() === true);

	// ---- a datetime change re-sorts ----
	const mover = cont._entries[Math.min(10, cont._entries.length - 1)];
	const oldDt = mover.datetime;
	mover.datetime = GLib.DateTime.new_now_utc();
	await co.sleep(500);
	co.chk('datetimeResortsToFront', cont._entries[0] === mover);
	co.chk('datetimeKeepsMirror', childrenMirror() === true);
	mover.datetime = oldDt;
	await co.sleep(400);

	dlg.close();
	await co.sleep(600);
	co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
	co.metric('entriesFinal', cont._entries.length);
	co.done();
})().catch((e) => globalThis.__co.fail(e));
