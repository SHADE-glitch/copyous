// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — tests for color.js, part of copyous@local.
//
// color.js is free of GNOME/GI imports, so it can be exercised under plain Node
// with no gjs and no dependencies:
//
//   npm test
//
// One caveat: the Color constructor calls `Math.clamp`, which is NOT a
// JavaScript built-in — GNOME Shell 50.1 injects it (libshell-18.so). The shim
// below is the shell's own definition, installed before any Color is built.
//
// The assertions follow the invariants color.js documents in its own comments
// (per-space ranges, hue normalization, parse precedence, invertible
// conversions). The four tests marked "regression" were written against a real
// defect and fail on the pre-fix code.

if (typeof Math.clamp !== "function")
    Math.clamp = (x, lower, upper) => Math.min(Math.max(x, lower), upper);

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Color, ColorSpace, ColorSpaces, NamedColors } from "../lib/common/color.js";

const EPS = 1e-9;
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

/** Assert two colors' channels match within `eps`. */
function closeChannels(actual, expected, eps = EPS) {
    for (const key of ["c1", "c2", "c3"]) {
        assert.ok(
            close(actual[key], expected[key], eps),
            `${key}: expected ${expected[key]}, got ${actual[key]} (eps ${eps})`
        );
    }
}

describe("exports", () => {
    it("ColorSpaces lists every ColorSpace exactly once, in order", () => {
        assert.deepEqual(ColorSpaces, Object.values(ColorSpace));
        assert.equal(new Set(ColorSpaces).size, ColorSpaces.length);
    });

    it("NamedColors is a plain own-property table", () => {
        assert.ok(Object.hasOwn(NamedColors, "red"));
        assert.equal(NamedColors.red.length, 3);
        // Nothing may be inherited from Object.prototype (see the regression below).
        assert.equal(Object.hasOwn(NamedColors, "constructor"), false);
    });
});

describe("constructor clamping", () => {
    it("clamps Rgb and Hex channels to [0, 255]", () => {
        for (const space of [ColorSpace.Rgb, ColorSpace.Hex]) {
            assert.equal(new Color(space, -10, 300, 12.5, 1).c1, 0);
            assert.equal(new Color(space, -10, 300, 12.5, 1).c2, 255);
            assert.equal(new Color(space, -10, 300, 12.5, 1).c3, 12.5);
        }
    });

    it("clamps Hsl and Hwb s/l to [0, 100]", () => {
        for (const space of [ColorSpace.Hsl, ColorSpace.Hwb]) {
            const c = new Color(space, 200, -5, 150, 1);
            assert.equal(c.c2, 0);
            assert.equal(c.c3, 100);
        }
    });

    it("clamps LinearRgb to [0, 1]", () => {
        const c = new Color(ColorSpace.LinearRgb, -0.5, 0.5, 2, 1);
        assert.equal(c.c1, 0);
        assert.equal(c.c2, 0.5);
        assert.equal(c.c3, 1);
    });

    it("floors Xyz at 0 and leaves it unbounded above", () => {
        const c = new Color(ColorSpace.Xyz, -0.5, 2, 0, 1);
        assert.equal(c.c1, 0);
        assert.equal(c.c2, 2, "Xyz has no upper bound");
        assert.equal(c.c3, 0);
    });

    it("clamps Lab to l [0, 100], a/b [-125, 125]", () => {
        const c = new Color(ColorSpace.Lab, 150, -200, 200, 1);
        assert.equal(c.c1, 100);
        assert.equal(c.c2, -125);
        assert.equal(c.c3, 125);
    });

    it("clamps Lch to l [0, 100], c [0, 150]", () => {
        const c = new Color(ColorSpace.Lch, -1, 200, 10, 1);
        assert.equal(c.c1, 0);
        assert.equal(c.c2, 150);
    });

    it("clamps Oklab to l [0, 1], a/b [-0.4, 0.4]", () => {
        const c = new Color(ColorSpace.Oklab, 2, -1, 1, 1);
        assert.equal(c.c1, 1);
        assert.equal(c.c2, -0.4);
        assert.equal(c.c3, 0.4);
    });

    it("clamps Oklch to l [0, 1], c [0, 0.4]", () => {
        const c = new Color(ColorSpace.Oklch, -1, 0.9, 10, 1);
        assert.equal(c.c1, 0);
        assert.equal(c.c2, 0.4);
    });

    it("clamps alpha to [0, 1]", () => {
        assert.equal(new Color(ColorSpace.Rgb, 0, 0, 0, 2).alpha, 1);
        assert.equal(new Color(ColorSpace.Rgb, 0, 0, 0, -1).alpha, 0);
        assert.equal(new Color(ColorSpace.Rgb, 0, 0, 0, 0.25).alpha, 0.25);
    });
});

describe("hue normalization", () => {
    const hueOf = (space, h) => new Color(space, h, 50, 50, 1).c1;

    it("keeps an in-range hue unchanged", () => {
        for (const h of [0, 0.5, 200, 359.5]) assert.equal(hueOf(ColorSpace.Hsl, h), h);
    });

    it("wraps a positive overflow", () => {
        assert.equal(hueOf(ColorSpace.Hsl, 360), 0);
        assert.equal(hueOf(ColorSpace.Hsl, 450), 90);
        assert.equal(hueOf(ColorSpace.Hsl, 720), 0);
    });

    it("wraps a negative hue into [0, 360)", () => {
        assert.equal(hueOf(ColorSpace.Hsl, -90), 270);
        assert.equal(hueOf(ColorSpace.Hsl, -450), 270);
    });

    it("regression: normalizes -360 like its positive twin 360", () => {
        // (c % 360) + (c < 0 ? 360 : 0) evaluates to 360 for c = -360, which is
        // outside the documented [0, 360) range, while 360 normalizes to 0.
        assert.equal(hueOf(ColorSpace.Hsl, -360), 0);
        assert.equal(hueOf(ColorSpace.Hsl, -720), 0);
        assert.equal(
            Color.parse("hsl(-360 50% 50%)").c1,
            Color.parse("hsl(360 50% 50%)").c1
        );
    });

    it("applies the same normalization to Hwb, Lch and Oklch", () => {
        assert.equal(hueOf(ColorSpace.Hwb, -360), 0);
        assert.equal(hueOf(ColorSpace.Lch, -360), 0);
        assert.equal(hueOf(ColorSpace.Oklch, -360), 0);
    });
});

describe("parse: named colors", () => {
    it("parses a name case-insensitively", () => {
        assert.equal(Color.parse("red").toString(), "rgb(255 0 0)");
        assert.equal(Color.parse("RED").toString(), "rgb(255 0 0)");
        assert.equal(Color.parse("rebeccapurple").toString(), "rgb(102 51 153)");
    });

    it("returns null for an unknown name", () => {
        assert.equal(Color.parse("not-a-color"), null);
        assert.equal(Color.parse(""), null);
    });

    it("regression: returns null for Object.prototype members instead of throwing", () => {
        // `str in NamedColors` is true for inherited properties, so destructuring
        // `constructor` / `__proto__` threw a TypeError. Reachable from
        // lib/misc/clipboard.js:366, where it dropped the whole clipboard entry.
        for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"])
            assert.equal(Color.parse(name), null, `${name} must not parse as a color`);
    });
});

describe("parse: hex", () => {
    it("dispatches on length 3 / 4 / 6 / 8", () => {
        assert.equal(Color.parse("#abc").space, ColorSpace.Hex);
        assert.equal(Color.parse("#abcd").space, ColorSpace.Hex);
        assert.equal(Color.parse("#aabbcc").space, ColorSpace.Hex);
        assert.equal(Color.parse("#aabbccdd").space, ColorSpace.Hex);
    });

    it("expands shorthand to the full channel value", () => {
        const c = Color.parse("#abc");
        assert.deepEqual([c.c1, c.c2, c.c3], [170, 187, 204]);
        assert.deepEqual(
            [Color.parse("#abcd").c1, Color.parse("#abcd").c2, Color.parse("#abcd").c3],
            [170, 187, 204]
        );
    });

    it("returns null for lengths 2 and 5", () => {
        assert.equal(Color.parse("#ab"), null);
        assert.equal(Color.parse("#abcde"), null);
    });

    it("returns null for a non-hex character or a bare #", () => {
        assert.equal(Color.parse("#xyz"), null);
        assert.equal(Color.parse("#"), null);
    });

    it("regression: keeps a zero alpha byte", () => {
        // `rgba[3] ? rgba[3] / 255 : 1` treated a 0 alpha byte as "no alpha",
        // so a fully transparent color came back opaque.
        for (const hex of ["#0000", "#00000000", "#abc0", "#ff000000"])
            assert.equal(Color.parse(hex).alpha, 0, `${hex} must stay transparent`);
        // A non-zero alpha is unaffected.
        assert.ok(close(Color.parse("#ff000080").alpha, 128 / 255));
        assert.equal(Color.parse("#abc").alpha, 1, "3-digit hex has no alpha");
    });
});

describe("parse: functional syntaxes", () => {
    it("parses rgb() / rgba() with spaces, commas, percentages and slash alpha", () => {
        assert.equal(Color.parse("rgb(10 20 30)").toString(), "rgb(10 20 30)");
        assert.equal(Color.parse("rgb(10, 20, 30)").toString(), "rgb(10 20 30)");
        assert.equal(Color.parse("rgb(100% 0% 0%)").toString(), "rgb(255 0 0)");
        assert.equal(Color.parse("rgba(10 20 30 / 0.5)").alpha, 0.5);
        assert.equal(Color.parse("rgba(10 20 30 0.25)").alpha, 0.25);
    });

    it("parses hsl() / hsla() angle units", () => {
        assert.equal(Color.parse("hsl(200 50% 40%)").toString(), "hsl(200 50% 40%)");
        assert.equal(Color.parse("hsl(200deg 50% 40%)").c1, 200);
        assert.equal(Color.parse("hsl(0.5turn 50% 40%)").c1, 180);
        assert.equal(Color.parse("hsl(200grad 50% 40%)").c1, 180);
        assert.ok(close(Color.parse("hsl(3.14159rad 50% 40%)").c1, 179.9998, 1e-3));
    });

    it("parses hwb(), color(srgb-linear …) and color(xyz …)", () => {
        assert.equal(Color.parse("hwb(210 20% 30%)").space, ColorSpace.Hwb);
        assert.equal(Color.parse("hwb(210 20% 30%)").toString(), "hwb(210 20% 30%)");
        const linear = Color.parse("color(srgb-linear 0.1 0.2 0.3)");
        assert.equal(linear.space, ColorSpace.LinearRgb);
        closeChannels(linear, { c1: 0.1, c2: 0.2, c3: 0.3 });
        const xyz = Color.parse("color(xyz 0.1 0.2 0.3)");
        assert.equal(xyz.space, ColorSpace.Xyz);
        closeChannels(xyz, { c1: 0.1, c2: 0.2, c3: 0.3 });
    });

    it("parses lab / lch / oklab / oklch, scaling percentages", () => {
        assert.equal(Color.parse("lab(50 20 -30)").toString(), "lab(50 20 -30)");
        assert.equal(Color.parse("lch(50 40 200)").toString(), "lch(50 40 200)");
        assert.equal(Color.parse("oklab(0.6 0.1 -0.1)").space, ColorSpace.Oklab);
        assert.equal(Color.parse("oklch(0.6 0.1 200)").toString(), "oklch(0.6 0.1 200)");
        // A percentage is a fraction of the space's own maximum.
        const c = Color.parse("lab(50% 20% -30%)");
        closeChannels(c, { c1: 50, c2: 25, c3: -37.5 });
    });

    it("clamps out-of-range channels instead of rejecting them", () => {
        assert.equal(Color.parse("rgb(300 0 0)").toString(), "rgb(255 0 0)");
    });

    it("returns null for malformed input", () => {
        for (const bad of ["rgb(10 20)", "hsl(200 50%)", "lab(50 20)", "rgb()", "color(xyz-d50 0.1 0.2 0.3)"])
            assert.equal(Color.parse(bad), null, `${bad} must not parse`);
    });
});

describe("toString", () => {
    it("formats each space in its own syntax", () => {
        const cases = [
            ["#ff8800", "#ff8800"],
            ["rgb(10 20 30)", "rgb(10 20 30)"],
            ["hsl(200 50% 40%)", "hsl(200 50% 40%)"],
            ["hwb(210 20% 30%)", "hwb(210 20% 30%)"],
            ["color(srgb-linear 0.1 0.2 0.3)", "color(srgb-linear 0.1 0.2 0.3)"],
            ["color(xyz 0.1 0.2 0.3)", "color(xyz 0.1 0.2 0.3)"],
            ["lab(50 20 -30)", "lab(50 20 -30)"],
            ["lch(50 40 200)", "lch(50 40 200)"],
            ["oklab(0.6 0.1 -0.1)", "oklab(0.6 0.1 -0.1)"],
            ["oklch(0.6 0.1 200)", "oklch(0.6 0.1 200)"],
        ];
        for (const [input, expected] of cases)
            assert.equal(Color.parse(input).toString(), expected);
    });

    it("omits alpha when it is exactly 1, includes it otherwise", () => {
        assert.equal(Color.parse("rgb(10 20 30)").toString(), "rgb(10 20 30)");
        assert.equal(Color.parse("rgba(10 20 30 / 0.5)").toString(), "rgb(10 20 30 / 0.5)");
        assert.equal(Color.parse("#ff8800").toString(), "#ff8800");
        assert.equal(Color.parse("#ff880080").toString(), "#ff880080");
    });
});

describe("conversions round-trip", () => {
    const SAMPLES = ["#000000", "#ffffff", "#ff8800", "#3366cc", "#123456", "#7f7f7f", "#00ff00", "#abcdef"];

    it("rgb -> hsl -> rgb", () => {
        for (const hex of SAMPLES)
            closeChannels(Color.parse(hex).hsl().rgb(), Color.parse(hex).rgb());
    });

    it("rgb -> linear -> rgb", () => {
        for (const hex of SAMPLES)
            closeChannels(Color.parse(hex).linear().rgb(), Color.parse(hex).rgb());
    });

    it("rgb -> xyz -> rgb (8-bit lossy, so a loose tolerance)", () => {
        for (const hex of SAMPLES)
            closeChannels(Color.parse(hex).xyz().rgb(), Color.parse(hex).rgb(), 0.5);
    });

    it("xyz -> lab -> xyz", () => {
        for (const hex of SAMPLES) {
            const xyz = Color.parse(hex).xyz();
            closeChannels(xyz.lab().xyz(), xyz);
        }
    });

    it("lab -> lch -> lab", () => {
        for (const hex of SAMPLES) {
            const lab = Color.parse(hex).lab();
            closeChannels(lab.lch().lab(), lab);
        }
    });

    it("xyz -> oklab -> xyz", () => {
        for (const hex of SAMPLES) {
            const xyz = Color.parse(hex).xyz();
            closeChannels(xyz.oklab().xyz(), xyz);
        }
    });

    it("oklab -> oklch -> oklab", () => {
        for (const hex of SAMPLES) {
            const oklab = Color.parse(hex).oklab();
            closeChannels(oklab.oklch().oklab(), oklab);
        }
    });

    it("hex -> rgb -> hex", () => {
        for (const hex of SAMPLES) assert.equal(Color.parse(hex).rgb().hex().toString(), hex);
    });

    it("regression: round-trips grayscale through HWB without darkening it", () => {
        // The `white + black >= 1` branch returned a 0–1 luminance as an Rgb
        // channel (which is 0–255), so every grayscale HWB color collapsed to
        // near-black: hwb(0 100% 0%) — i.e. white — became #010101.
        for (const hex of ["#ffffff", "#000000", "#7f7f7f", "#404040"])
            closeChannels(Color.parse(hex).hwb().rgb(), Color.parse(hex).rgb());
        assert.equal(Color.parse("hwb(0 100% 0%)").hex().toString(), "#ffffff");
        assert.equal(Color.parse("hwb(0 50% 50%)").hex().toString(), "#808080");
    });

    it("rgb -> hwb -> rgb for non-gray colors", () => {
        for (const hex of ["#ff8800", "#3366cc", "#123456", "#abcdef"])
            closeChannels(Color.parse(hex).hwb().rgb(), Color.parse(hex).rgb(), 0.5);
    });
});

describe("luminance", () => {
    it("is 1 for white and 0 for black", () => {
        assert.equal(Color.parse("white").luminance(), 1);
        assert.equal(Color.parse("black").luminance(), 0);
    });

    it("uses the Rec. 709 weights on linearized channels", () => {
        assert.ok(close(Color.parse("red").luminance(), 0.2126));
        assert.ok(close(Color.parse("lime").luminance(), 0.7152));
        assert.ok(close(Color.parse("blue").luminance(), 0.0722));
    });
});
