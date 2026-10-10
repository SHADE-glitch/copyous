// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — synthetic clipboard database for the headless harness.
//
//   node test/headless/make-fixture.js [--out <dir>]
//
// Why a generator instead of a committed snapshot: the live history is private
// clipboard content (paths, code, URLs, screenshots) and must never enter git, and
// a 1.7 MB blob drifts from the schema the moment a migration lands. Generating it
// keeps the harness reproducible from the repo alone.
//
// The shape is deliberately isomorphic to the real database this fork is tuned
// against, because several assertions are arithmetic on the row count (the windowed
// scroll extent must equal n*itemExtent + (n-1)*spacing exactly):
//
//   255 rows = Text 169 + Code 66 + Image 7 + File 5 + Files 5 + Link 3
//   5 pinned, 0 tagged, clipboard_version = 3
//
// Runs on plain Node with no dependencies: `node:sqlite` for the database and
// `node:zlib` for the PNGs. Both are built in, which is what keeps this out of the
// "no npm / no build chain" prohibition.
//
// Hermetic by construction: Link rows carry a non-null `metadata`, so LinkItem takes
// its `if (this.entry.metadata)` branch and never reaches tryGetMetadata()'s network
// fetch. Image rows point at PNGs this script writes next to the database.

import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------------
// Deterministic PRNG. Counts and ordering must be identical on every run or
// the probes' assertions become meaningless.
// --------------------------------------------------------------------------
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(20261001);
const pick = (xs) => xs[Math.floor(rnd() * xs.length) % xs.length];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// --------------------------------------------------------------------------
// Minimal PNG writer (8x8 RGB, filter byte 0 per scanline).
// --------------------------------------------------------------------------
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

/**
 * A minimal truecolour PNG. `pixel(x, y)` returns [r, g, b].
 *
 * The 8x8 swatches are all the list needs to render an Image item, but the notification
 * path decodes at *full* size, so probe 10 needs one image with the pixel count of a real
 * screenshot (1728x1056 is this machine's) -- a 74-byte file measures nothing there.
 */
function png(width, height, pixel) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour
	const stride = 1 + width * 3;
	const raw = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		const off = y * stride;
		raw[off] = 0; // filter: none
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pixel(x, y);
			raw[off + 1 + x * 3] = r;
			raw[off + 2 + x * 3] = g;
			raw[off + 3 + x * 3] = b;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const png8x8 = (rgb) => png(8, 8, () => rgb);

// Gradient, not noise: the pixel count is what costs to decode, and a gradient keeps the
// fixture archive small enough to regenerate on every `COPYOUS_REFRESH_FIXTURE=1`.
const SCREENSHOT = [1728, 1056];
const pngScreenshot = () =>
	png(SCREENSHOT[0], SCREENSHOT[1], (x, y) => [(x * 3 + y) & 0xff, (x ^ y) & 0xff, (y * 5) & 0xff]);

// --------------------------------------------------------------------------
// Content pools. Mixed ASCII and CJK on purpose: non-ASCII is what catches a
// UTF-16-vs-UTF-8 length bug (codeLabel passes -1 to markup_escape_text so GLib
// counts bytes) and the truncation path at PREVIEW_MAX_CHARS.
// --------------------------------------------------------------------------
const CJK = [
	'会议纪要：本地生活服务平台改版',
	'后端工程师 · 前端认知与协作导师',
	'八股 × 项目 —— AI 模拟面试系统版',
	'现代前端工程 + Vue/React 导师模式',
	'数据库索引优化笔记（待确认）',
];
const LATIN = [
	'The quick brown fox jumps over the lazy dog',
	'FIXME: this race only reproduces under load',
	'grep -rn "clipboard" lib/ | head -20',
	'sudo systemctl status gnome-shell',
	'Please review the divergence list before merging',
	'openssl dgst -sha256 -sign key.pem artifact.tar',
];
const LANGS = [
	['json', 'JSON'],
	['javascript', 'JavaScript'],
	['python', 'Python'],
	['bash', 'Bash'],
	['sql', 'SQL'],
	['typescript', 'TypeScript'],
];

function textContent(i) {
	const base = i % 3 === 0 ? pick(CJK) : pick(LATIN);
	if (i % 11 === 0) {
		// Long enough to exceed PREVIEW_MAX_CHARS (600) and hit the truncation path.
		// The #i suffix is load-bearing: UNIQUE(type, content) rejects duplicates.
		return `${base} — ${'lorem ipsum dolor sit amet '.repeat(30)}#${i}`;
	}
	return `${base} #${i}`;
}

function codeContent(i) {
	const [id] = pick(LANGS);
	const lines = int(3, 9);
	const body = [];
	for (let l = 0; l < lines; l++) body.push(`  // line ${l} of fixture snippet ${i}\n  const v${l} = ${int(0, 999)};`);
	return `function fixture_${i}(${id}) {\n${body.join('\n')}\n  return ${id};\n}`;
}

function fileUri(path) {
	return `file://${path.split('/').map((seg) => encodeURIComponent(seg)).join('/')}`;
}

function fileContent(i) {
	return fileUri(`/fixture/docs/report ${i}.pdf`);
}

function filesContent(i) {
	const dir = `/fixture/Documents/02-Workspace/00-Prompts batch ${i}`;
	const n = int(3, 5);
	const rows = [];
	for (let k = 0; k < n; k++) rows.push(fileUri(`${dir}/笔记 ${k}.md`));
	return rows.join('\n');
}

function linkContent(i) {
	return `https://example.test/article/${i}-${pick(['perf', 'notes', 'rfc', 'post'])}`;
}

// --------------------------------------------------------------------------
// Row plan: the exact type distribution and pinned count of the real database.
// --------------------------------------------------------------------------
const PLAN = [
	['Text', 169],
	['Code', 66],
	['Image', 7],
	['File', 5],
	['Files', 5],
	['Link', 3],
];
const TOTAL = PLAN.reduce((s, [, n]) => s + n, 0);
const PINNED = 5;

// Populated while building Image rows, drained by main().
const pngFiles = new Map();
let imageRow = 0;

function buildRows(imagesDir) {
	const rows = [];
	let serial = 0;
	for (const [type, n] of PLAN) {
		for (let i = 0; i < n; i++) {
			// Spread over ~30 days, newest last so the fill order is realistic.
			serial++;
			const when = new Date(Date.now() - serial * 168000);
			const datetime = when.toISOString().slice(0, 19).replace('T', ' ');
			let content;
			let metadata = null;
			switch (type) {
				case 'Code':
					content = codeContent(i);
					// Half carry a resolved language (highlight path), half do not
					// (highlightAuto path) -- both are on the per-item construction cost.
					if (i % 2 === 0) {
						const [id, name] = pick(LANGS);
						metadata = JSON.stringify({ language: { id, name } });
					}
					break;
				case 'File':
					content = fileContent(i);
					metadata = JSON.stringify({ operation: i % 2 ? 'cut' : 'copy' });
					break;
				case 'Files':
					content = filesContent(i);
					metadata = JSON.stringify({ operation: 'copy' });
					break;
				case 'Link':
					content = linkContent(i);
					// Non-null metadata is what keeps the harness off the network.
					metadata = JSON.stringify({ title: null, description: null, image: null });
					break;
				case 'Image': {
					const name = `fixture${String(i).padStart(24, '0')}`;
					// Exactly one Image row is screenshot-sized. The list is happy with a
					// 74-byte swatch; the notification preview decodes at full resolution,
					// and probe 10 measures *that* -- see png() above.
					pngFiles.set(
						`${imagesDir}/${name}.png`,
						imageRow++ === 0 ? pngScreenshot() : png8x8([int(20, 235), int(20, 235), int(20, 235)]),
					);
					content = `file://${imagesDir}/${name}.png`;
					break;
				}
				default:
					content = textContent(i);
			}
			rows.push({ type, content, pinned: 0, tag: null, datetime, metadata, title: null });
		}
	}
	// Pin a spread of types, not just text, so the pinned-protection paths run:
	// rows 0-168 are Text, 169-234 Code, 235-241 Image, 242-246 File, 247-251 Files.
	for (const idx of [10, 90, 200, 240, 250]) rows[idx].pinned = 1;
	return rows;
}

function main() {
	const outIdx = process.argv.indexOf('--out');
	const outDir = resolve(outIdx === -1 ? '/tmp/copyous-fixture' : process.argv[outIdx + 1]);
	const imagesDir = `${outDir}/images`;
	mkdirSync(imagesDir, { recursive: true });

	const dbPath = `${outDir}/fixture.db`;
	const rows = buildRows(imagesDir);
	for (const [path, bytes] of pngFiles) writeFileSync(path, bytes);

	const db = new DatabaseSync(dbPath);
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS 'clipboard_version' (
			'id' integer PRIMARY KEY CHECK (id = 1), 'version' integer
		);
		CREATE TABLE IF NOT EXISTS 'clipboard' (
			'id'       integer   NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT,
			'type'     text      NOT NULL,
			'content'  text      NOT NULL,
			'pinned'   boolean   NOT NULL,
			'tag'      text,
			'datetime' timestamp NOT NULL,
			'metadata' text, 'title' text,
			UNIQUE ('type', 'content')
		);
	`);
	db.exec('DELETE FROM clipboard;');
	db.prepare('INSERT INTO clipboard_version (id, version) VALUES (1, 3) ON CONFLICT(id) DO UPDATE SET version=3').run();

	const ins = db.prepare(
		'INSERT INTO clipboard (type, content, pinned, tag, datetime, metadata, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
	);
	for (const r of rows)
		ins.run(r.type, r.content, r.pinned, r.tag, r.datetime, r.metadata, r.title);

	const counts = db.prepare('select type, count(*) as n from clipboard group by type order by type').all();
	const pinned = db.prepare('select count(*) as n from clipboard where pinned=1').get().n;
	const total = db.prepare('select count(*) as n from clipboard').get().n;
	db.close();

	console.log(`fixture: ${dbPath}`);
	console.log(`images : ${imagesDir} (${pngFiles.size} png)`);
	console.log(`rows   : ${total}  pinned: ${pinned}  version: 3`);
	console.log(`types  : ${counts.map((c) => `${c.type}=${c.n}`).join(' ')}`);
	if (total !== TOTAL || pinned !== PINNED) {
		console.error(`FATAL: expected ${TOTAL} rows / ${PINNED} pinned`);
		process.exit(1);
	}
}

main();
