// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 14: one selection box, remembered per view scope.
//
// Alt only flips searchEntry.pinned (clipboardDialog.js:892-895); the setter
// re-runs search() (searchEntry.js:465-469), the single funnel into
// ClipboardScrollContainer.search(). query.pinned is the only thing separating
// the two views, so drive the REAL chain. Do NOT normalise with mk(''): its
// excludePinned=false (probes/_preamble.js:230) disagrees with every config's
// exclude-pinned=true and would fold pinned rows into the normal view.
(async () => {
	const co = globalThis.__co;
	const BUDGET = 30000;

	if (
		!(await co.phase('scope-memory', BUDGET, async () => {
			const { cont, dlg, searchEntry, focusedEntry } = await co.enable();
			dlg.open();
			await co.sleep(900);
			cont.cancelProgressiveReveal();
			await co.sleep(300);

			const nPinned = cont._entries.filter((e) => e.pinned).length;
			const nNormal = cont._entries.length - nPinned;
			co.metric('pinnedRows', nPinned);
			co.metric('normalRows', nNormal);
			// exclude-pinned=true keeps the two views disjoint and both non-empty.
			co.chk('fixtureHasBothViews', nPinned >= 3 && nNormal >= 4 ? true : { nPinned, nNormal });
			co.chk(
				'viewsAreDisjoint',
				cont._filtered.every((e) => !e.pinned) ? true : 'normal view contains a pinned row',
			);
			if (nPinned < 3 || nNormal < 4) return;

			// Put the box on the 4th normal row -- deliberately not the first.
			const target = cont._filtered[3];
			cont.focusEntry(target, false);
			await co.sleep(400);
			co.chk('startsOnChosenRow', focusedEntry() === target ? true : { observedIndex: cont._filtered.indexOf(focusedEntry()) });

			// Alt -> pinned view: a box must exist, on that view's first row
			// (no remembered selection there yet).
			searchEntry.pinned = true;
			await co.sleep(500);
			const pinnedFirst = cont._filtered[0];
			co.chk('pinnedShowsABox', focusedEntry() !== null ? true : 'no key focus in pinned view');
			co.chk(
				'pinnedStartsAtFirst',
				focusedEntry() === pinnedFirst ? true : { observedIndex: cont._filtered.indexOf(focusedEntry()) },
			);

			// Move within the pinned view so it has its own remembered row.
			const pinnedPick = cont._filtered[1];
			cont.focusEntry(pinnedPick, false);
			await co.sleep(400);
			co.chk('pinnedMovesWithinView', focusedEntry() === pinnedPick ? true : { observedIndex: cont._filtered.indexOf(focusedEntry()) });

			// Alt -> back to normal: the box must return to the 4th row, not the
			// normal first row and not the row selected in the pinned view. This
			// is the assertion the pre-fix tree fails: search() fell through to
			// focusEntry(_filtered[0]) and clobbered the remembered position.
			searchEntry.pinned = false;
			await co.sleep(500);
			co.chk(
				'returnsToPreAltRow',
				focusedEntry() === target
					? true
					: { observedIndex: cont._filtered.indexOf(focusedEntry()), expectedIndex: 3 },
			);

			// Alt -> pinned again: that view keeps its own remembered row.
			searchEntry.pinned = true;
			await co.sleep(500);
			co.chk(
				'pinnedRemembersItsOwn',
				focusedEntry() === pinnedPick
					? true
					: { observedIndex: cont._filtered.indexOf(focusedEntry()), expectedIndex: 1 },
			);
			co.chk('boxNeverLostOnRoundTrip', focusedEntry() !== null ? true : 'no key focus after round trip');
		}))
	)
		return co.done();

	co.done();
})().catch((e) => globalThis.__co.fail(e));
