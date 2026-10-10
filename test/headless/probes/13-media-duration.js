// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — probe 13: an audio row must show the duration GStreamer reads from the file.
//
// Why this exists. `tryCreateMediaFileInfo()` is the function that `gi://Gst` was made dynamic
// for, and it had no coverage anywhere: the fixture had no row whose file resolved to `audio/*`,
// so in every arm and every session that branch simply never ran. A fix whose only proof is "the
// extension still loads" is not proof -- and the other half of it (a machine *without*
// GStreamer) cannot be produced here at all, because the typelib is installed. What can be
// produced is the success path, which is what the degradation has to be measured against.
//
// The expected duration is not a constant copied into this file. It is derived from the WAV's own
// RIFF header, so the fixture can change length and the assertion stays true -- and so a header
// the generator wrote wrong fails here rather than quietly re-defining "correct".
//
// Two more legs that are not about duration:
//   * the stored content must be percent-encoded (`%20` in the file name), because that is the
//     shape a real copy from Files has -- an audio path with a space used to be decoded by
//     string slicing everywhere the preview URI was taken apart;
//   * a File row that is *not* audio must not grow a duration widget, which is what keeps the
//     `switch (fileType)` honest: an over-broad case would pass leg 1 by accident.
//
// The item has to be materialised to be observed, and the list is windowed -- so the probe
// filters by type File, which leaves 5 rows and puts all of them in the viewport.

(async () => {
	const co = globalThis.__co;
	const Gio = imports.gi.Gio;

	const h = await co.enable();
	const { cont, SearchChange, q } = h;

	const rows = () => cont._entries.filter((e) => e.type === 'File');
	const audio = () => rows().filter((e) => decodeURIComponent(e.content).endsWith('.wav'));

	const a = audio();
	co.chk('exactlyOneAudioRow', a.length === 1 ? true : `found ${a.length} of ${rows().length} File rows`);
	if (a.length !== 1) return co.done();
	const entry = a[0];
	const file = Gio.File.new_for_uri(entry.content);

	co.chk(
		'storedUriIsPercentEncoded',
		entry.content.includes('%20') ? true : `content reads ${entry.content}`,
	);
	co.chk('audioRowExistsOnDisk', file.query_exists(null) ? true : `missing: ${file.get_path()}`);

	// --- expected duration, straight from the header ----------------------------------
	// `read_bytes(...).get_data()` hands back the byte array *itself*, not a `[bytes, size]`
	// tuple -- destructuring it takes element 0, a number, and every field then reads as
	// undefined. Verified against the installed GJS before writing it this way.
	let expectedSeconds = -1;
	const stream = file.read(null);
	if (stream) {
		const buf = stream.read_bytes(44, null).get_data();
		const u32 = (o) => buf[o] + (buf[o + 1] << 8) + (buf[o + 2] << 16) + buf[o + 3] * 16777216;
		const u16 = (o) => buf[o] + (buf[o + 1] << 8);
		const rate = u32(24);
		const align = u16(32);
		const dataSize = u32(40);
		co.chk('riffMagic', String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === 'RIFF' ? true : `first four bytes are ${buf[0]},${buf[1]},${buf[2]},${buf[3]}`);
		expectedSeconds = rate > 0 && align > 0 ? dataSize / (rate * align) : -1;
		co.metric('riffRate', rate);
		co.metric('riffBlockAlign', align);
		co.metric('riffDataBytes', dataSize);
		stream.close(null);
	} else co.chk('riffMagic', 'the wav could not be opened -- the header leg did not run');
	co.chk('riffHeaderYieldsThreeSeconds', expectedSeconds === 3 ? true : `derived ${expectedSeconds}s`);

	// --- observe the built item --------------------------------------------------------
	cont.search(q(SearchChange.Different, '', { type: 'File' }));
	for (let i = 0; i < 20; i++) {
		if (h.itemChildren().some((it) => it.entry?.content === entry.content)) break;
		await co.sleep(150);
	}
	const item = h.itemChildren().find((it) => it.entry?.content === entry.content);
	co.chk('audioItemMaterialised', item !== undefined ? true : `visible items: ${h.itemChildren().length}`);
	if (!item) return co.done();

	// getFileType() and createFileInfo() are async; give the cancellable path time to land.
	for (let i = 0; i < 60 && !item._fileInfo; i++) await co.sleep(150);
	const info = item._fileInfo;
	co.chk('fileInfoBuilt', info ? true : 'the item never produced a FileInfo');

	/** Every style class in the actor subtree. St.Widget exposes the class list as one
	 *  space-separated string via get_style_class_name(); get_style_classes() is not a thing. */
	function classes(actor) {
		const seen = [];
		const walk = (a) => {
			if (!a) return;
			for (const c of String(a.get_style_class_name?.() ?? '').split(' ')) if (c) seen.push(c);
			for (const kid of a.get_children?.() ?? []) walk(kid);
		};
		walk(actor);
		return seen;
	}
	function labelTexts(actor) {
		const out = [];
		const walk = (a) => {
			if (a?.text !== undefined) out.push(String(a.text));
			for (const kid of a?.get_children?.() ?? []) walk(kid);
		};
		walk(actor);
		return out;
	}

	const hasDuration = info ? classes(info).includes('media-duration') : false;
	co.chk('mediaDurationWidgetBuilt', hasDuration ? true : `classes on the FileInfo: ${info ? classes(info).join(',') : 'n/a'}`);

	const texts = info ? labelTexts(info) : [];
	// formatTime() renders sub-minute durations as "<n>s"; the number comes from the header
	// derivation above, so the fixture can change length without this becoming a magic string.
	const expectedText = expectedSeconds >= 0 && expectedSeconds < 60 ? `${Math.floor(expectedSeconds)}s` : null;
	co.chk(
		'durationLabelMatchesRiffHeader',
		expectedText === null
			? `no expected value (header said ${expectedSeconds}s) -- this leg did not run`
			: texts.includes(expectedText)
				? true
				: `wanted ${expectedText}, labels: ${JSON.stringify(texts)}`,
	);

	// The negative leg: a non-audio File row must not show a duration.
	const other = rows().find((e) => e.content !== entry.content && !decodeURIComponent(e.content).endsWith('.wav'));
	const otherItem = h.itemChildren().find((it) => it.entry?.content === other?.content);
	if (otherItem?._fileInfo)
		co.chk(
			'nonAudioRowHasNoDuration',
			classes(otherItem._fileInfo).includes('media-duration') ? `it does: ${JSON.stringify(labelTexts(otherItem._fileInfo))}` : true,
		);
	else co.chk('nonAudioRowHasNoDuration', 'the comparison row was never materialised -- this leg did not run');

	cont.search(q(SearchChange.Different, ''));
	co.done();
})().catch((e) => globalThis.__co.fail(e));
