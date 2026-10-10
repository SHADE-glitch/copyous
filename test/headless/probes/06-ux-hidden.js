// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 06: things a person would actually feel, which 01-05 do not
// look at.
//
// 01-05 assert correctness and aggregate cost. They never ask: *what kind* of row is
// expensive to rebuild, does scrolling issue database writes, does an animated focus
// move build rows it then throws away, can the selection blink out while still on
// screen, does the scrollbar thumb resize, does memory keep climbing across repeated
// passes, and does pinning a row make it vanish under the cursor.
//
// Each block below runs inside co.phase()'s budget, so the block that goes wrong is named
// in the verdict instead of eating the harness's 450s poll. The budgets are the observed
// phase times of a passing run times several -- a red means "go look at that phase", not
// "this is slow". Numbers and how they were taken: docs/maintenance/verification.md.
(async () => {
	const co = globalThis.__co;
	const BUDGET = {
		open: 30000,
		scroll: 60000,
		blink: 20000,
		ease: 15000,
		thumb: 15000,
		pin: 15000,
		empty: 15000,
		close: 10000,
	};
	// The scroll loop's own bound. Observed steps per pass on the 255-row fixture: ~82 in `live`
	// (max 45110 / (per 182 * rowsPerViewport 3)) and ~49 in `horizontal` (64237 / (262 * 5)).
	// 400 is far above either, so reaching it means that arithmetic has degenerated -- which is
	// what used to spin instead of finishing.
	const STEP_CAP = 400;

	let Main, inst, dlg, cont, itemChildren, focusedEntry;
	let windowed = false;
	let realFactory = null;
	let restoreWriteCounter = null;
	const byType = {};
	let dbWrites = 0;
	const dbProps = {};
	let per = 0;
	let rowsPerViewport = 0;
	let max = 0;
	let cappedAt = 0;
	const adj = () => cont._axisAdjustment();

	if (
		!(await co.phase('open', BUDGET.open, async () => {
			({ Main, inst, dlg, cont, itemChildren, focusedEntry } = await co.enable());

			windowed = cont._windowable();
			co.metric('windowable', windowed);

			// ---- instrument row construction, bucketed by entry type ----
			realFactory = cont._factory;
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

			per = cont._perItem();
			rowsPerViewport = Math.max(1, Math.ceil(adj().page_size / per));
			max = Math.max(0, adj().upper - adj().page_size);
			co.metric('scrollLoopParams', `per=${per} rowsPerViewport=${rowsPerViewport} max=${max}`);
		}))
	)
		return co.done();

	// ---- three full passes: does cost and memory settle, or keep climbing? ----
	if (
		!(await co.phase('scroll', BUDGET.scroll, async () => {
			const passes = [];
			for (let pass = 0; pass < 3 && !cappedAt; pass++) {
				const before = Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.ms]));
				const writesBefore = dbWrites;
				const t0 = co.ms();
				let worst = 0;
				let steps = 0;
				for (let i = 0; i * per * rowsPerViewport <= max; i++) {
					// One line per step. The 2026-10-10 stalls all landed inside this loop, and the
					// main thread never returns to the deadline, so nothing but a marker written
					// *before* the step can say which step it died on. Printing after a slow step
					// would be useless -- the freeze happens during it.
					print(`[copyous-probe] scroll pass=${pass} step=${i}`);
					const t = co.ms();
					adj().value = Math.min(max, Math.round(i * per * rowsPerViewport));
					worst = Math.max(worst, co.ms() - t);
					steps++;
					if (steps > STEP_CAP) {
						cappedAt = steps;
						break;
					}
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
			co.chk(
				'scrollLoopNeverCapped',
				cappedAt === 0 ? true : { cappedAt, stepCap: STEP_CAP, per, rowsPerViewport, max },
			);
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
		}))
	)
		return co.done();

	if (!windowed) {
		// The rest of this probe is about windowing's side effects.
		await co.phase('close', BUDGET.close, async () => {
			dlg.close();
			await co.sleep(600);
			co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
		});
		return co.done();
	}

	// ---- can the selection blink out while still on screen? ----
	// The window is [first - rowsPerViewport, first + 2*rowsPerViewport + 1) and the
	// visible rows are [first, first + rowsPerViewport], so a focused row inside the
	// viewport must stay resident however the viewport moves over it.
	if (
		!(await co.phase('blink', BUDGET.blink, async () => {
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
		}))
	)
		return co.done();

	// ---- does one animated focus move thrash the window? ----
	// focusEntry(animate=true) eases for 150ms; every frame fires notify::value and can
	// shift the window, building rows it throws away again at the end of the ease.
	if (
		!(await co.phase('ease', BUDGET.ease, async () => {
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
		}))
	)
		return co.done();

	// ---- scrollbar geometry: the thumb is page_size/upper ----
	// If the spacers were even slightly off, the thumb would resize as you scroll.
	if (
		!(await co.phase('thumb', BUDGET.thumb, async () => {
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
		}))
	)
		return co.done();

	// ---- pinning a row while exclude-pinned is on: does it vanish under the cursor? ----
	// middle-click-action defaults to 'pin'.
	if (
		!(await co.phase('pin', BUDGET.pin, async () => {
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
		}))
	)
		return co.done();

	// ---- empty history: the state a fresh install boots into ----
	if (
		!(await co.phase('empty', BUDGET.empty, async () => {
			cont.clearItems();
			await co.sleep(400);
			co.chk('emptyShowsEmptyState', cont._statusItem.get_parent() === cont && cont._statusItem.state === 0);
			co.chk('emptyMaterializesNothing', cont._items.size === 0);
			co.chk('emptyHasNoStrayChildren', cont.get_n_children() === 1);

			dlg.close();
			await co.sleep(600);
			co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
		}))
	)
		return co.done();

	co.done();
})().catch((e) => globalThis.__co.fail(e));
