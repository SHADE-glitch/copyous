// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — the phrases the fixture puts into clipboard bodies, read out of
// test/headless/make-fixture.js itself.
//
// Why it derives them instead of listing them: the log sentinel needs the exact strings that
// land in entry bodies, and a hand-copied list would go stale the moment the fixture changes --
// turning the sentinel into a gate that quietly matches nothing. Parsing the generator means the
// two can never disagree.
//
// An empty or short list is a fault in THIS script, not a green run, so every failure mode exits
// non-zero with a reason: run.sh treats a failed extraction as a failed run.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, 'make-fixture.js'), 'utf8');

const out = [];
for (const pool of ['CJK', 'LATIN']) {
	const m = src.match(new RegExp(`const ${pool} = \\[([\\s\\S]*?)\\n\\];`, 'm'));
	if (!m) {
		console.error(`FATAL: no \`const ${pool} = [\``);
		process.exit(3);
	}
	const found = [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]);
	if (found.length === 0) {
		console.error(`FATAL: \`const ${pool}\` yielded zero string literals -- the parser is wrong, not the fixture`);
		process.exit(3);
	}
	out.push(...found);
}

// Structural markers of the generated code bodies: these are what a Code row contains, and they
// carry the fixture's own wording rather than any user's.
for (const literal of ['lorem ipsum dolor sit amet', 'of fixture snippet', 'function fixture_']) {
	if (!src.includes(literal)) {
		console.error(`FATAL: make-fixture.js no longer contains "${literal}" -- update this list`);
		process.exit(3);
	}
	out.push(literal);
}

if (out.length < 8) {
	console.error(`FATAL: only ${out.length} phrases extracted; expected at least the two pools plus 3 literals`);
	process.exit(3);
}

console.log(out.join('\n'));
