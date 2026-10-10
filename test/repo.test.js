// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — repository-level guards for copyous@local.
//
// These tests assert nothing about runtime behaviour. They guard invariants of the
// repository itself: the two-file bilingual README pair staying in step, the maintenance
// handbook's router reaching every topic file, and no citation by section number anywhere
// that ships. A silent violation here costs nothing at runtime and everything at review
// time, so it belongs in `npm test` (desktop-free: no gjs, no GNOME, no network).
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

    // HTTP status codes must agree across a pair: a code named on one side alone is a
    // fact that silently contradicts the other language. A code counts only in an HTTP
    // context (or quoted in backticks), so a plain number like `500 ms` never counts.
    const STATUS = "200|201|202|204|206|301|302|303|304|307|308|400|401|402|403|404|405|406|"
        + "407|408|409|410|411|412|413|414|415|416|417|418|421|422|423|424|425|426|428|"
        + "429|431|451|499|500|501|502|503|504|505|506|507|508|510|511";
    const STATUS_RE = new RegExp(
        "(?:HTTP|status|状态码|返回|returns?|responds?|replies?|answers?|gives?)[^\\n]{0,30}?\\b(" + STATUS + ")\\b"
        + "|`(" + STATUS + ")`"
        + "|`(" + STATUS + ")\\s*\\+", "gi");

    it("the bilingual pairs name the same HTTP status codes", () => {
        const codes = (text) => {
            const out = new Set();
            for (const m of text.matchAll(STATUS_RE))
                out.add(m[1] || m[2] || m[3]);
            return [...out].sort();
        };
        for (const [en, zh] of pairs) {
            const ce = codes(read(en)), cz = codes(read(zh));
            assert.deepEqual(ce, cz,
                `${en} names [${ce}] but ${zh} names [${cz}] — the two languages disagree on a status code`);
        }
    });

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

    // INVARIANTS.md is a pointer file: its whole claim is that it owns no prose that lives
    // elsewhere. That claim is only real if something checks it, because the failure mode --
    // pasting a CHANGELOG line in because it reads better here -- produces a document that
    // looks more useful while quietly becoming the copy that rots.
    it("INVARIANTS.md restates nothing from the record it points at", () => {
        const pointer = read("INVARIANTS.md");
        assert.match(pointer, /check-log\.mjs --invariants/,
            "INVARIANTS.md must name the command that prints the recorded fixes; that is the alternative to copying them");
        const record = read("CHANGELOG.md").split("\n").map(l => l.trim()).filter(Boolean);
        for (const own of ["INVARIANTS.md", "INVARIANTS.zh-CN.md"]) {
            for (const line of read(own).split("\n").map(l => l.trim()).filter(l => l.length > 20)) {
                const clash = record.find(r => r === line || (r.length > 30 && line.includes(r)));
                assert.equal(clash, undefined,
                    `${own} carries a line verbatim out of CHANGELOG.md -- print it with --invariants instead: ${line.slice(0, 70)}`);
            }
        }
    });

    // The maintenance handbook is a router over `docs/maintenance/`. Two things can go wrong
    // silently when its prose moves: a file nobody links (invisible, so nobody reads it and
    // someone writes the fact a second time elsewhere), and a citation by section number
    // (the numbers were a property of the old single file, and they now resolve to nothing).
    it("every maintenance topic file is reachable from the router", () => {
        const topics = FILES.filter(f => f.startsWith("docs/maintenance/") && f.endsWith(".md"));
        assert.ok(topics.length >= 1, "no topic files found under docs/maintenance/ -- the split is gone");
        const router = read("MAINTENANCE.md");
        for (const f of topics)
            assert.ok(router.includes(`](${f})`), `${f} is not linked from MAINTENANCE.md; an unlinked file does not exist`);
    });

    it("nothing cites a section number, because no file numbers its sections any more", () => {
        // The forbidden character is built with String.fromCharCode, not written literally:
        // a guard that spells out what it forbids trips on its own source. This one found
        // exactly that on its first run.
        const SECTION_SIGN = String.fromCharCode(0xa7);
        // `docs/reports/` is dated scratch: it is gitignored, and its records quote the handbook
        // as it read when the note was written. Everything that ships is held to the rule.
        const cited = FILES
            .filter(f => /\.(md|js|mjs|sh)$/.test(f))
            .filter(f => !f.startsWith("docs/reports/"))
            .filter(f => read(f).includes(SECTION_SIGN));
        assert.deepEqual(cited, [],
            `these files still cite a section number: ${cited.join(", ")} -- point at the file instead`);
    });
});
