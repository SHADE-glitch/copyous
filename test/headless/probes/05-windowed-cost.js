// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 05: what windowing costs and what it buys.
//
// This probe deliberately reports more than it asserts. Scroll cost is the *price* of
// viewport materialization (~13x per viewport crossed in the A/B that landed it), so a
// threshold here would either be so loose it never fires or so tight it turns a
// known-good trade into a red build. The numbers are recorded as metrics and judged by
// a human against the baseline in docs/maintenance/baseline.md.
//
// The structural checks are the ones that should never regress: the resident set must
// stay bounded when windowing and must equal the list when it is not.
(async () => {
	const co = globalThis.__co;
	const { Main, dlg, cont } = await co.enable();

	const windowed = cont._windowable();
	const adj = () => cont._axisAdjustment();
	co.metric('windowable', windowed);
	co.metric('entries', cont._entries.length);
	co.metric('materializedAfterFill', cont._items.size);
	co.metric('rssAfterFillMB', co.rssMB());
	co.chk('fillArrived', cont._entries.length > 100);

	// Three open/close cycles. The complaint this all started from was the second and
	// later opens as much as the first, so a single cycle proves nothing.
	const opens = [];
	let peak = cont._items.size;
	for (let cycle = 0; cycle < 3; cycle++) {
		const t = co.ms();
		dlg.open();
		const callMs = Math.round((co.ms() - t) * 10) / 10;
		await co.sleep(900);
		cont.cancelProgressiveReveal();
		peak = Math.max(peak, cont._items.size);
		opens.push({
			cycle,
			openCallMs: callMs,
			settledMs: Math.round(co.ms() - t),
			materialized: cont._items.size,
			rssMB: co.rssMB(),
		});
		if (cycle < 2) {
			dlg.close();
			await co.sleep(700);
		}
	}
	co.rec('opens', opens);
	co.chk('opensMaterializeSomething', opens.every((o) => o.materialized > 0));

	// Walk the whole list one viewport at a time and time each window shift.
	const per = cont._perItem();
	// Must match _materialized()'s ceil() exactly, or this bound is off by one viewport
	// and the probe fails against correct code. (It did.)
	const view = Math.max(1, Math.ceil(adj().page_size / per));
	const max = Math.max(0, adj().upper - adj().page_size);
	const steps = [];
	let totalMs = 0;
	for (let i = 0; i * per * view <= max; i++) {
		const t = co.ms();
		adj().value = Math.min(max, Math.round(i * per * view));
		const dt = co.ms() - t;
		steps.push(dt);
		totalMs += dt;
		await co.sleep(60);
		peak = Math.max(peak, cont._items.size);
	}
	const sorted = steps.slice().sort((a, b) => a - b);
	co.rec('scrollWalk', {
		viewportItems: view,
		perItem: per,
		steps: steps.length,
		totalMs: Math.round(totalMs),
		medianMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : 0,
		worstMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : 0,
		peakMaterialized: peak,
		rssMB: co.rssMB(),
	});
	co.metric('scrollMedianMs', sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : 0);
	co.metric('scrollWorstMs', sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : 0);
	co.metric('peakMaterialized', peak);

	// The resident set is the whole point, so this is the one hard gate.
	if (windowed) {
		// Window is [viewport - view, viewport + 2*view + 1) => at most 3*view + 1.
		co.chk('residentSetStaysBounded', peak <= 3 * view + 2);
		co.chk('residentSetFarBelowList', peak < cont._entries.length / 4);
	} else {
		co.chk('unwindowedResidentSetIsTheList', peak === cont._entries.length);
	}

	adj().value = 0;
	await co.sleep(500);
	co.metric('rssBackAtTopMB', co.rssMB());

	dlg.close();
	await co.sleep(800);
	co.chk('finalModalReleased', Main.modalActorFocusStack?.length === 0);
	co.metric('rssFinalMB', co.rssMB());
	co.done();
})().catch((e) => globalThis.__co.fail(e));
