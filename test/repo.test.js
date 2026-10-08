// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — repository-level guards for copyous@local.
//
// These tests assert nothing about runtime behaviour. They guard an invariant of
// the repository itself: the two-file bilingual README pair staying in step. A
// silent violation here costs nothing at runtime and everything at review time,
// so it belongs in `npm test` (desktop-free: no gjs, no GNOME, no network).
//
//   npm test
//
// Deliberately shallow: only the top-level `##` section COUNT and the language
// switcher are compared, never deep content or `###` subsections. The Chinese
// README is the authoritative divergence list and intentionally carries three
// extra `###` subsections under "Changes vs upstream" that the English one
// omits (see AGENTS.md); asserting on those would fight the documented design.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every file in the working tree, skipping VCS noise. */
function listFiles() {
    const out = [];
    const skip = new Set([".git", "node_modules"]);
    const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
            if (skip.has(e.name))
                continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory())
                walk(r);
            else if (e.isFile())
                out.push(r);
        }
    };
    walk("");
    return out.sort();
}

const FILES = listFiles();
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("documentation conventions hold", () => {
    // House convention across every fork in this workspace: user-facing docs are
    // a two-file bilingual pair, English first. Section COUNT is the enforceable
    // version of that rule; heading line numbers cannot survive a prose edit.
    const pairs = FILES
        .filter(f => f.endsWith(".md") && path.dirname(f) === ".")
        .filter(f => f.endsWith(".zh-CN.md"))
        .map(zh => [zh.replace(/\.zh-CN\.md$/, ".md"), zh]);

    it("every Chinese doc has an English twin with the same section count", () => {
        assert.ok(pairs.length >= 1, "no bilingual pairs found");
        for (const [en, zh] of pairs) {
            assert.ok(FILES.includes(en), `${zh} has no English twin (${en})`);
            const h2 = (f) => (read(f).match(/^## /gm) || []).length;
            assert.equal(h2(en), h2(zh),
                `${en} has ${h2(en)} sections but ${zh} has ${h2(zh)} — keep the pair in step`);
            for (const f of [en, zh])
                assert.match(read(f), /^<p align="right"><a href=/,
                    `${f} must open with the language switcher so the pair stays navigable`);
        }
    });

    it("no tracked markdown uses task checkboxes", () => {
        for (const f of FILES.filter(x => x.endsWith(".md")))
            assert.ok(!/^\s*- \[[ xX]\]/m.test(read(f)), `${f} contains a task checkbox`);
    });
});
