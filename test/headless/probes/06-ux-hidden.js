// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 06: things a person would actually feel, which 01-05 do not
// look at.
//
// 01-05 assert correctness and aggregate cost. They never ask: *what kind* of row is
// expensive to rebuild, does scrolling issue database writes, does an animated focus
// move build rows it then throws away, can the selection blink out while still on
// screen, does the scrollbar thumb resize, does memory keep climbing across repeated
// passes, and does pinning a row make it vanish under the cursor.
(async () => {
	const co = globalThis.__co;
	const { Main, inst, dlg, cont, itemChildren, focusedEntry } = await co.enable();

	const adj = () => cont._axisAdjustment();
	const windowed = cont._windowable();
	co.metric('windowable', windowed);

	// ---- instrument row construction, bucketed by entry type ----
	const realFactory = cont._factory;
	const byType = {};
	cont._factory = (entry) => {
		const t0 = co.ms();
		const item = realFactory(entry);
		const ms = co.ms() - t0;
		const b = (byType[entry.type] ??= { n: 0, ms: 0, max: 0 });
		b.n++;
		b.ms += ms;
		b.max = Math.max(b.max, ms);
		return item;
	};

	dlg.open();
	await co.sleep(900);
	cont.cancelProgressiveReveal();
	await co.sleep(300);

	// ---- do database writes move from startup onto the scroll path? ----
	// CodeItem persists a detected language and entryTracker turns notify::metadata into
	// an UPDATE (entryTracker.js:333). Unwindowed that all happens during the fill;
	// windowed, a row's first detection happens as it scrolls into view.
	let dbWrites = 0;
	const dbProps = {};
	let restoreWriteCounter = null;
	if (inst.entryTracker?._database) {
		const proto = Object.getPrototypeOf(inst.entryTracker._database);
		const orig = proto.updateProperty;
		proto.updateProperty = function (entry, property) {
			dbWrites++;
			dbProps[property] = (dbProps[property] ?? 0) + 1;
			return orig.call(this, entry, property);
		};
		restoreWriteCounter = () => {
			proto.updateProperty = orig;
		};
	}
	co.rec('dbWritesAtOpen', dbWrites);

	// ---- three full passes: does cost and memory settle, or keep climbing? ----
	const per = cont._perItem();
	const rowsPerViewport = Math.max(1, Math.ceil(adj().page_size / per));
	const max = Math.max(0, adj().upper - adj().page_size);
	const passes = [];
	for (let pass = 0; pass < 3; pass++) {
		const before = Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.ms]));
		const writesBefore = dbWrites;
		const t0 = co.ms();
		let worst = 0;
		let steps = 0;
		for (let i = 0; i * per * rowsPerViewport <= max; i++) {
			const t = co.ms();
			adj().value = Math.min(max, Math.round(i * per * rowsPerViewport));
			worst = Math.max(worst, co.ms() - t);
			steps++;
			await co.sleep(40);
		}
		passes.push({
			pass,
			steps,
			totalMs: Math.round(co.ms() - t0),
			worstStepMs: Math.round(worst * 10) / 10,
			// Construction time added by this pass alone. Passes 2 and 3 should be
			// cheaper if lazy language detection is what costs.
			constructMs: Math.round(
				Object.entries(byType).reduce((s, [k, v]) => s + (v.ms - (before[k] ?? 0)), 0),
			),
			dbWrites: dbWrites - writesBefore,
			rssMB: co.rssMB(),
		});
	}
	co.rec('scrollPasses', passes);
	co.rec(
		'constructionByType',
		Object.fromEntries(
			Object.entries(byType).map(([k, v]) => [
				k,
				{
					n: v.n,
					totalMs: Math.round(v.ms),
					meanMs: Math.round((v.ms / v.n) * 10) / 10,
					maxMs: Math.round(v.max * 10) / 10,
				},
			]),
		),
	);
	co.rec('dbWritesDuringScroll', { total: dbWrites, byProperty: dbProps });
	restoreWriteCounter?.();
	cont._factory = realFactory;

	if (!windowed) {
		// The rest of this probe is about windowing's side effects.
		dlg.close();
		await co.sleep(600);
		co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
		return co.done();
	}

	// ---- can the selection blink out while still on screen? ----
	// The window is [first - rowsPerViewport, first + 2*rowsPerViewport + 1) and the
	// visible rows are [first, first + rowsPerViewport], so a focused row inside the
	// viewport must stay resident however the viewport moves over it.
	let droppedWhileVisible = 0;
	const dropCases = [];
	for (const anchorIdx of [10, 60, 120, 200]) {
		const anchor = cont._filtered[anchorIdx];
		if (!anchor) continue;
		cont.focusEntry(anchor, false);
		await co.sleep(200);
		for (let d = -rowsPerViewport; d <= rowsPerViewport; d++) {
			adj().value = Math.max(0, Math.min(max, (anchorIdx - rowsPerViewport + d) * per));
			await co.sleep(50);
			const first = Math.floor(adj().value / per);
			const onScreen = anchorIdx >= first && anchorIdx <= first + rowsPerViewport;
			if (onScreen && !cont._items.has(anchor)) {
				droppedWhileVisible++;
				if (dropCases.length < 5) dropCases.push({ anchorIdx, d, first });
			}
		}
	}
	co.chk('selectionNeverDroppedWhileVisible', droppedWhileVisible === 0);
	co.rec('selectionDroppedWhileVisible', dropCases);

	// ---- does one animated focus move thrash the window? ----
	// focusEntry(animate=true) eases for 150ms; every frame fires notify::value and can
	// shift the window, building rows it throws away again at the end of the ease.
	adj().value = 0;
	await co.sleep(400);
	const countBuilt = () => Object.values(byType).reduce((s, v) => s + v.n, 0);
	const built0 = countBuilt();
	const target = cont._filtered[Math.min(cont._filtered.length - 1, rowsPerViewport * 12)];
	cont.focusEntry(target, true);
	await co.sleep(700);
	const builtDuringEase = Object.values(byType).reduce((s, v) => s + v.n, 0) - built0;
	co.chk('easedFocusLands', focusedEntry() === target);
	co.rec('easedFocus', {
		targetIndex: cont._filtered.indexOf(target),
		rowsBuiltDuringOneEase: builtDuringEase,
		neededAtLanding: cont._items.size,
	});

	// ---- scrollbar geometry: the thumb is page_size/upper ----
	// If the spacers were even slightly off, the thumb would resize as you scroll.
	const thumbs = [];
	for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
		adj().value = Math.round(frac * max);
		await co.sleep(200);
		thumbs.push(Math.round((adj().page_size / adj().upper) * 1e6) / 1e6);
	}
	// Relative, not absolute: horizontal carries the known 15px-per-exposed-end extent
	// deviation (probe 04 bounds it the same way), which moves the thumb by 0.026% --
	// 0.006px on a 24px thumb. A 1e-6 absolute test flagged that as jank. A real spacer
	// bug would be percent-level, so 0.1% still catches what matters.
	co.chk('thumbSizeStable', (Math.max(...thumbs) - Math.min(...thumbs)) / thumbs[0] < 0.001);
	co.rec('thumbSize', {
		values: thumbs,
		relativeSpreadPct: Math.round(((Math.max(...thumbs) - Math.min(...thumbs)) / thumbs[0]) * 1e4) / 100,
	});

	// ---- pinning a row while exclude-pinned is on: does it vanish under the cursor? ----
	// middle-click-action defaults to 'pin'.
	adj().value = 0;
	await co.sleep(300);
	const pinTarget = cont._filtered[1];
	const filteredBefore = cont._filtered.length;
	pinTarget.pinned = true;
	await co.sleep(400);
	co.rec('pinBehaviour', {
		excludePinned: inst.settings.get_boolean('exclude-pinned'),
		filteredBefore,
		filteredAfter: cont._filtered.length,
		vanishedImmediately: !cont._filtered.includes(pinTarget),
	});
	pinTarget.pinned = false;
	await co.sleep(300);

	// ---- empty history: the state a fresh install boots into ----
	cont.clearItems();
	await co.sleep(400);
	co.chk('emptyShowsEmptyState', cont._statusItem.get_parent() === cont && cont._statusItem.state === 0);
	co.chk('emptyMaterializesNothing', cont._items.size === 0);
	co.chk('emptyHasNoStrayChildren', cont.get_n_children() === 1);

	dlg.close();
	await co.sleep(600);
	co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
	co.done();
})().catch((e) => globalThis.__co.fail(e));
