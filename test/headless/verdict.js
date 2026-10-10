// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — turn one probe result into a PASS/FAIL line.
//
// Probes report two separate things: `checks` (booleans that must all hold) and
// `steps` (measurements, printed but not judged). Keeping them apart is what lets a
// number change without the suite going red, and lets a real regression be red
// without anyone reading a table.
import { readFileSync } from 'node:fs';

const [, , path, name] = process.argv;
let r;
try {
	r = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
	console.log(`     ${name}: UNREADABLE (${e.message.split('\n')[0]})`);
	process.exit(1);
}

if (r.phase === 'skipped') {
	console.log(`     ${name}: SKIP  ${r.reason || ''}`);
	process.exit(0);
}
if (r.phase !== 'done') {
	console.log(`     ${name}: phase=${r.phase} err=${(r.err || '').split('\n')[0]}`);
	process.exit(1);
}

const checks = r.checks || {};
const bad = Object.entries(checks).filter(([, v]) => v !== true);
const status = bad.length === 0 ? 'PASS' : 'FAIL';
console.log(`     ${name}: ${status}  ${Object.keys(checks).length - bad.length}/${Object.keys(checks).length} checks`);
// A phase table is the whole point of the budget mechanism: when a `phase:<name>` check is red,
// the line above it has to say how long that phase took and what it was waiting on.
if (Array.isArray(r.phases) && r.phases.length) {
	console.log(`       phases: ${r.phases.map((p) => `${p.phase}=${p.ms}/${p.budgetMs}ms${p.outcome === 'done' ? '' : `(${p.outcome})`}`).join('  ')}`);
}
for (const [k, v] of bad) console.log(`       ✗ ${k} = ${JSON.stringify(v)}`);
if (r.metrics) console.log(`       ${Object.entries(r.metrics).map(([k, v]) => `${k}=${v}`).join('  ')}`);
process.exit(bad.length === 0 ? 0 : 1);
