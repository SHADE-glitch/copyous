// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — the settings window must offer a way back from every setting it exposes.
//
// Guards `scripts/settings-coverage.mjs`, the static cross-check between
// `schemas/org.gnome.shell.extensions.copyous.gschema.xml` and `lib/preferences/**`.
// It belongs in `npm test` because the failures it catches are silent by construction:
//
//   * `makeResettable(row, settings, 'typoed-key')` returns the row untouched — no button,
//     no error, and the window looks fine.
//   * a new setting added without a reset button is a missing affordance, not a crash, so
//     nothing at runtime notices either.
//
// Desktop-free: no gjs, no GNOME, no display, no user data.
//
//   npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("settings coverage", () => {
    it("every setting the schema declares is exposed and resettable, or deliberately is not", () => {
        let out;
        try {
            out = execFileSync(process.execPath, [path.join(REPO, "scripts", "settings-coverage.mjs")], {
                cwd: REPO,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (e) {
            const report = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
            assert.fail(`settings-coverage.mjs says the settings window is incomplete:\n${report}`);
        }
        // Reading green from silence is not enough: exit 0 with a truncated report would hide
        // the counts, and the counts are the thing being asserted.
        assert.match(out, /RESULT: PASS/, `no verdict in output:\n${out}`);
        assert.match(out, /-- controls WITHOUT a reset button: 0\n/);
        assert.match(out, /-- used by prefs but absent from the schema: 0\n/);
    });
});
