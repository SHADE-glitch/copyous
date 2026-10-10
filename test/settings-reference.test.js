// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — the README's settings table must be the schema, not a memory of it.
//
// `scripts/settings-reference.mjs` renders the key/type/default block that sits between the
// `settings-reference` markers in both READMEs. Two failures are possible and both are silent
// at runtime: the block goes stale (a key ships undocumented), or the parser quietly drops a
// key shape and the table looks complete while missing rows -- that is the `flags=` bug of
// 2026-10-09, which the script now refuses to output by comparing its own count against the
// raw `<key` occurrences.
//
// Provoked 2026-10-10: adding a key to the schema made --check exit 2 on both READMEs, and
// stripping `type=` off that key made it exit 2 with "declares 83 keys but the parser found 82".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (arg) => {
    const r = spawnSync('node', [path.join('scripts', 'settings-reference.mjs'), arg],
        { cwd: REPO, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('README settings reference matches the schema', () => {
    const check = run('--check');

    it('is current in both languages, and says so', () => {
        assert.equal(check.code, 0, `--check exited ${check.code}:\n${check.stdout}${check.stderr}`);
        assert.match(check.stdout, /RESULT: PASS/);
        // Never green from silence: both files have to be reported, not just one.
        for (const f of ['README.md', 'README.zh-CN.md'])
            assert.match(check.stdout, new RegExp(`${f}: current`), `--check did not examine ${f}`);
    });

    it('renders one row per declared key into each marked block', () => {
        const total = Number(/(\d+) keys/.exec(check.stdout)?.[1] ?? 0);
        assert.ok(total > 50, `the script reported ${total} keys -- the schema parser is not finding the real set`);
        for (const f of ['README.md', 'README.zh-CN.md']) {
            const text = fs.readFileSync(path.join(REPO, f), 'utf8');
            const m = /<!-- settings-reference:start -->([\s\S]*?)<!-- settings-reference:end -->/.exec(text);
            assert.ok(m, `${f} has no settings-reference block`);
            const rows = (m[1].match(/^\| `/gm) ?? []).length;
            assert.equal(rows, total, `${f} documents ${rows} keys but the schema declares ${total}`);
        }
    });

    it('keeps the two generated blocks the same size', () => {
        const sizes = ['README.md', 'README.zh-CN.md'].map((f) => {
            const m = /<!-- settings-reference:start -->([\s\S]*?)<!-- settings-reference:end -->/
                .exec(fs.readFileSync(path.join(REPO, f), 'utf8'));
            return (m[1].match(/^\| `/gm) ?? []).length;
        });
        assert.equal(sizes[0], sizes[1], `the pair describes different key sets: ${sizes.join(' vs ')}`);
    });
});
