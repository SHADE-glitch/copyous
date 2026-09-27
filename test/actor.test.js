// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — tests for actor.js, part of copyous@local.
//
// actor.js has no imports at all, so it runs under plain Node with no gjs and no
// dependencies:
//
//   npm test
//
// Every function here is duck-typed over a Clutter.Actor, so a fake tree is
// enough. The invariants worth pinning are the "visible" filter and the edges:
// every traversal must skip hidden actors and return null at the ends rather
// than wrapping around or throwing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    get_n_visible_children,
    get_next_visible_sibling,
    get_previous_visible_sibling,
    get_first_visible_child,
    get_last_visible_child,
} from "../lib/misc/actor.js";

/**
 * A fake Clutter actor: a doubly linked sibling chain plus a child list, which
 * is exactly the shape actor.js walks.
 */
function fakeActor(visible = true, ...children) {
    const actor = {
        visible,
        _next: null,
        _previous: null,
        get_children: () => children,
        get_first_child: () => children[0] ?? null,
        get_last_child: () => children[children.length - 1] ?? null,
        get_next_sibling: () => actor._next,
        get_previous_sibling: () => actor._previous,
    };
    children.forEach((child, index) => {
        child._previous = children[index - 1] ?? null;
        child._next = children[index + 1] ?? null;
    });
    return actor;
}

/** A parent whose children have the given visibilities, e.g. "hvh". */
function tree(pattern) {
    const children = [...pattern].map((flag) => fakeActor(flag === "v"));
    return { parent: fakeActor(true, ...children), children };
}

describe("get_n_visible_children", () => {
    it("counts only visible children", () => {
        assert.equal(get_n_visible_children(tree("vvh").parent), 2);
        assert.equal(get_n_visible_children(tree("hhh").parent), 0);
        assert.equal(get_n_visible_children(tree("vvv").parent), 3);
    });

    it("returns 0 for a childless actor", () => {
        assert.equal(get_n_visible_children(fakeActor(true)), 0);
    });

    it("does not recurse into grandchildren", () => {
        // A visible child counts once, no matter what it contains.
        const grandchild = fakeActor(false);
        const child = fakeActor(true, grandchild);
        const parent = fakeActor(true, child);
        assert.equal(get_n_visible_children(parent), 1);
    });
});

describe("get_next_visible_sibling", () => {
    it("returns the immediately following visible sibling", () => {
        const { children } = tree("vvv");
        assert.equal(get_next_visible_sibling(children[0]), children[1]);
        assert.equal(get_next_visible_sibling(children[1]), children[2]);
    });

    it("skips hidden siblings", () => {
        const { children } = tree("vhhv");
        assert.equal(get_next_visible_sibling(children[0]), children[3]);
    });

    it("returns null at the end of the chain", () => {
        const { children } = tree("vv");
        assert.equal(get_next_visible_sibling(children[1]), null);
    });

    it("returns null when only hidden siblings follow", () => {
        const { children } = tree("vhh");
        assert.equal(get_next_visible_sibling(children[0]), null);
    });

    it("returns null for an only child", () => {
        const { children } = tree("v");
        assert.equal(get_next_visible_sibling(children[0]), null);
    });
});

describe("get_previous_visible_sibling", () => {
    it("returns the immediately preceding visible sibling", () => {
        const { children } = tree("vvv");
        assert.equal(get_previous_visible_sibling(children[2]), children[1]);
        assert.equal(get_previous_visible_sibling(children[1]), children[0]);
    });

    it("skips hidden siblings", () => {
        const { children } = tree("vhhv");
        assert.equal(get_previous_visible_sibling(children[3]), children[0]);
    });

    it("returns null at the start of the chain", () => {
        const { children } = tree("vv");
        assert.equal(get_previous_visible_sibling(children[0]), null);
    });

    it("returns null when only hidden siblings precede", () => {
        const { children } = tree("hhv");
        assert.equal(get_previous_visible_sibling(children[2]), null);
    });
});

describe("get_first_visible_child", () => {
    it("returns the first child when it is visible", () => {
        const { parent, children } = tree("vvv");
        assert.equal(get_first_visible_child(parent), children[0]);
    });

    it("skips leading hidden children", () => {
        const one = tree("hvv");
        assert.equal(get_first_visible_child(one.parent), one.children[1]);
        const { parent, children } = tree("hhv");
        assert.equal(get_first_visible_child(parent), children[2]);
    });

    it("returns null when every child is hidden", () => {
        assert.equal(get_first_visible_child(tree("hhh").parent), null);
    });

    it("returns null for a childless actor", () => {
        assert.equal(get_first_visible_child(fakeActor(true)), null);
    });
});

describe("get_last_visible_child", () => {
    it("returns the last child when it is visible", () => {
        const { parent, children } = tree("vvv");
        assert.equal(get_last_visible_child(parent), children[2]);
    });

    it("skips trailing hidden children", () => {
        const { parent, children } = tree("vhh");
        assert.equal(get_last_visible_child(parent), children[0]);
        const two = tree("vhhh");
        assert.equal(get_last_visible_child(two.parent), two.children[0]);
    });

    it("returns null when every child is hidden", () => {
        assert.equal(get_last_visible_child(tree("hhh").parent), null);
    });

    it("returns null for a childless actor", () => {
        assert.equal(get_last_visible_child(fakeActor(true)), null);
    });
});
