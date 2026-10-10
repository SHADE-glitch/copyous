// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 10: copying an image must not stall the compositor twice.
//
// What this guards. `NotificationManager.notification()` used to pay for the same PNG
// *twice* on the shell's main thread, inside the clipboard `owner-changed` handler:
// `Pixbuf.get_file_info(path)` to get the dimensions, then
// `Pixbuf.new_from_file_at_scale(path, 256, 256, true)` for the preview. Both open and
// inflate the whole file. Measured on the maintainer's own screenshots (1728x1056,
// 2419x1478): 18-78ms and 17-57ms, so one image copy blocked the compositor for up to
// ~130ms. `preview()` now decodes once and reads the dimensions off that decode.
//
// Why the fixture needed a real-sized PNG first. All seven fixture images were 74 bytes and
// `send-notification` defaults to false, so **no arm and no probe ever ran this branch**.
// Both gaps had to be closed before "fixed" could mean anything: this probe turns the
// setting on, and `make-fixture.js` writes one 1728x1056 image.
//
// Two measurements, judged differently.
//   * Reported, not gated: how much the handler blocks relative to *one* warm decode of the
//     same file, sampled the same way in the same session (median of three rounds each).
//     Measured here: HEAD (two passes) 53ms against a 24ms reference = 2.2x, the single-pass
//     fix 31ms against 18ms = 1.7x. A 10% margin on a machine that is also drawing is not a
//     trustworthy gate -- see docs/maintenance/reading-the-log.md -- so both numbers go into the result JSON for a human to
//     compare across runs.
//   * Gated, deterministic: the stored content is a percent-encoded URI, and the old branch
//     stripped `file://` and handed the *escaped* text to GdkPixbuf as a path. An image whose
//     path needs any escaping therefore decoded to nothing: the copy was announced with no
//     preview and no size. `preview()` goes through `Gio.File.new_for_uri`, so a notification
//     for `probe 10 escaped.png` must arrive with a real size line.
//
// What this cannot show: that the stall is *gone*. gdk-pixbuf's PNG path inflates at
// end-of-data, so nothing in this process spreads one decode across iterations (slicing a
// PixbufLoader measured 0.5-0.9ms per 64KB write and 62ms inside `close()`, and
// `new_from_stream_at_scale_async` blocks 32-50ms). The remaining ~1x is a recorded,
// unfixed cost -- see `docs/maintenance/open-items.md`.

(async () => {
	const co = globalThis.__co;
	const GLib = imports.gi.GLib;
	const Gio = imports.gi.Gio;
	const GdkPixbuf = imports.gi.GdkPixbuf;
	const St = imports.gi.St;

	// The dormant branch is only reachable with the setting on -- see the header.
	globalThis.__coCfg['send-notification'] = true;
	const h = await co.enable();
	const nm = h.inst.notificationManager;
	if (!nm) throw new Error('notificationManager missing even with send-notification=true');

	// The screenshot-sized Image entry, picked by file size so a renumbered fixture cannot
	// silently turn this into a measurement of a 74-byte swatch.
	const images = h.cont._entries
		.filter((e) => e.type === 'Image')
		.map((e) => [e, Gio.File.new_for_uri(e.content)])
		.filter(([_, f]) => f.query_exists(null));
	images.sort(
		(a, b) =>
			(b[1].query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size() ?? 0) -
			(a[1].query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size() ?? 0),
	);
	const [entry, file] = images[0] ?? [];
	if (!entry) throw new Error('the fixture has no reachable Image entry to copy');
	const size = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
	co.metric('imageBytes', size);
	co.chk('subjectIsScreenshotSized', size > 100000 ? true : `largest fixture image is ${size} bytes`);

	const notifications = () => nm._source?.notifications ?? [];
	// Prime both caches (page cache and gdk-pixbuf's module load) so the reference and the
	// measured call are compared under the same conditions.
	nm.notification(entry);
	await co.sleep(400);

	/**
	 * Run `work` three times and return the median of the largest main-loop gap each run
	 * produced. Median rather than one sample because the gap is a timing measurement on a
	 * desktop that is also drawing: a single round varies by ~10ms and the gate compares two
	 * quantities of similar size, so the noise has to be damped before it is judged.
	 */
	async function blockedRound(work) {
		let maxGap = 0;
		let ticks = 0;
		let last = co.ms();
		const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			const now = co.ms();
			ticks++;
			maxGap = Math.max(maxGap, now - last);
			last = now;
			return GLib.SOURCE_CONTINUE;
		});
		await co.sleep(20);
		work();
		// The loop needs a turn *after* the blocking work and before the ticker is removed.
		// Without it the gap the work just caused is never observed, and the reading collapses
		// to ~1ms -- which is how this probe first went green against the unfixed code.
		await co.sleep(20);
		GLib.source_remove(id);
		return { maxGap, ticks };
	}

	async function median(work) {
		const samples = [];
		let ticks = 0;
		for (let i = 0; i < 3; i++) {
			const r = await blockedRound(work);
			samples.push(r.maxGap);
			ticks += r.ticks;
			await co.sleep(30);
		}
		samples.sort((a, b) => a - b);
		return { maxGap: samples[1], ticks };
	}

	// --- the reference: exactly one warm decode + the scale it feeds -------------------
	const decodeOnce = () => {
		const full = GdkPixbuf.Pixbuf.new_from_file(file.get_path());
		full.scale_simple(256, Math.round((256 * full.get_height()) / full.get_width()), GdkPixbuf.InterpType.BILINEAR);
	};
	const refSample = await median(decodeOnce);
	const ref = refSample.maxGap;
	co.metric('oneWarmDecodeMs', Math.round(ref));
	co.metric('referenceTicks', refSample.ticks);
	co.chk(
		'referenceDecodeWasMeasured',
		ref >= 5 ? true : `a single warm decode measured ${Math.round(ref)}ms -- too small to compare against`,
	);

	// --- the handler, sampled the same way --------------------------------------------
	const before = notifications().length;
	const t0 = co.ms();
	const handlerSample = await median(() => nm.notification(entry));
	const maxGap = handlerSample.maxGap;
	const wall = co.ms() - t0;
	co.metric('handlerMaxGapMs', Math.round(maxGap));
	co.metric('handlerAppearedAfterMs', Math.round(wall));
	co.metric('loopTicks', handlerSample.ticks);
	// The instrument proves it was wired up before its reading is trusted.
	co.chk(
		'loopActuallyTicked',
		handlerSample.ticks >= 6 ? true : `only ${handlerSample.ticks} timer ticks in ${Math.round(wall)}ms -- maxGap means nothing`,
	);
	await co.sleep(60);
	const note = notifications()[notifications().length - 1];
	co.chk('imageNotificationArrived', notifications().length > before ? true : `still ${before} after ${Math.round(wall)}ms`);
	co.chk('bodyReportsPixelSize', /\d+×\d+ px/.test(note?.body ?? '') ? true : `body=${JSON.stringify(note?.body)}`);
	co.chk('previewIsAnImage', note?.gicon instanceof St.ImageContent ? true : `gicon is ${note?.gicon?.constructor?.name ?? typeof note?.gicon}`);
	// The ratio is reported, not gated: 1.7x against a 2.2x regression is a 10% margin on a
	// machine that is also drawing, and docs/maintenance/reading-the-log.md is explicit that timings like this are not
	// trustworthy gates. The two numbers are in the result JSON, so drift is visible.
	co.metric('blockedOverOneDecode', Number(ref ? (maxGap / ref).toFixed(2) : 0));

	// The deterministic gate. The stored content is a percent-encoded URI, and the branch
	// used to strip `file://` and hand the *escaped* text to GdkPixbuf as a path -- so an
	// image whose path needs escaping decoded to nothing and the copy was announced without
	// a preview or a size. That is testable without measuring any clock. Written under the
	// isolated app-data dir, never into $WORK/fixture, which is the pristine seed sessions
	// copy from.
	const scratch = Gio.File.new_build_filenamev([GLib.get_user_data_dir(), 'copyous@local', 'images']);
	if (!scratch.query_exists(null)) scratch.make_directory_with_parents(null);
	const spaced = scratch.get_child('probe 10 escaped.png');
	GdkPixbuf.Pixbuf.new_from_file(file.get_path()).savev(spaced.get_path(), 'png', [], []);
	const beforeEscaped = notifications().length;
	nm.notification({ type: 'Image', content: spaced.get_uri() });
	await co.sleep(400);
	const escapedNote = notifications()[notifications().length - 1];
	co.chk(
		'escapedImagePathStillDecodes',
		notifications().length > beforeEscaped && /\d+×\d+ px/.test(escapedNote?.body ?? '')
			? true
			: `notification for ${spaced.get_uri()} produced ${JSON.stringify(escapedNote?.body ?? null)}`,
	);
	spaced.delete(null);

	// The other branches share the function, so prove the change did not only touch images.
	// Called directly rather than through `emit('clipboard')`: that handler also feeds the
	// entry to the dialog, which would make this a test of a synthesised entry instead.
	const beforeText = notifications().length;
	nm.notification({ type: 'Text', content: 'probe ten text entry' });
	await co.sleep(400);
	co.chk('textBranchStillWorks', notifications().length > beforeText ? true : `count=${notifications().length}`);

	co.done();
})().catch((e) => globalThis.__co.fail(e));
