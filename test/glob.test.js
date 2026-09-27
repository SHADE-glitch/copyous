// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — tests for glob.js, part of copyous@local.
//
// glob.js has no imports at all, so it runs under plain Node with no gjs and no
// dependencies:
//
//   npm test
//
// It translates a glob pattern into a regular-expression SOURCE string (callers
// do `new RegExp(globToRegex(pattern))` — see lib/preferences/customization/
// items/exclusions.js). The assertions below pin the documented semantics:
// anchoring, `/`-aware wildcards, globstar, character classes, brace expansion
// and metacharacter escaping.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { globToRegex } from "../lib/common/glob.js";

/** Compile a glob the way the app does. */
const re = (pattern) => new RegExp(globToRegex(pattern));
const matches = (pattern, string) => re(pattern).test(string);

describe("globToRegex contract", () => {
    it("returns a regex source string, not a RegExp", () => {
        assert.equal(typeof globToRegex("*.js"), "string");
        assert.equal(globToRegex("*.js"), "^[^\\/]*\\.js$");
    });

    it("anchors every alternative at both ends", () => {
        for (const pattern of ["a", "*.js", "a/b", "{x,y}"])
            for (const alternative of globToRegex(pattern).split("|"))
                assert.ok(
                    alternative.startsWith("^") && alternative.endsWith("$"),
                    `${pattern}: alternative ${alternative} is not anchored`
                );
    });

    it("joins multiple patterns with |", () => {
        assert.equal(globToRegex("*.js", "*.ts"), "^[^\\/]*\\.js$|^[^\\/]*\\.ts$");
    });

    it("matches the whole string, not a substring", () => {
        assert.equal(matches("*.js", "a.js"), true);
        assert.equal(matches("*.js", "a.js.bak"), false);
        assert.equal(matches("a", "xa"), false);
    });
});

describe("wildcards", () => {
    it("* matches within a path segment but never crosses /", () => {
        assert.equal(matches("*", "abc"), true);
        assert.equal(matches("*", ""), true);
        assert.equal(matches("*", "a/b"), false);
        assert.equal(matches("a/*/b", "a/x/b"), true);
        assert.equal(matches("a/*/b", "a/x/y/b"), false);
    });

    it("? matches exactly one non-/ character", () => {
        assert.equal(matches("a?b", "axb"), true);
        assert.equal(matches("a?b", "ab"), false);
        assert.equal(matches("a?b", "axxb"), false);
        assert.equal(matches("a?b", "a/b"), false);
    });

    it("** crosses /, and **/ makes the directory prefix optional", () => {
        assert.equal(matches("**", "a/b/c"), true);
        assert.equal(matches("**", ""), true);
        assert.equal(matches("**/*.js", "y.js"), true, "zero leading directories");
        assert.equal(matches("**/*.js", "x/y.js"), true);
        assert.equal(matches("a/**/b", "a/b"), true, "zero intermediate directories");
        assert.equal(matches("a/**/b", "a/x/b"), true);
        assert.equal(matches("a/**/b", "a/x/y/b"), true);
    });

    it("treats three or more stars as a single-segment wildcard (documented behaviour)", () => {
        // Only a run of exactly two stars is a globstar; `***` is not standard
        // glob syntax, so this is the existing, intended behaviour.
        assert.equal(globToRegex("***"), "^[^\\/]*$");
        assert.equal(matches("***", "abc"), true);
        assert.equal(matches("***", "a/b/c"), false);
    });
});

describe("character classes", () => {
    it("passes a class through, including ranges", () => {
        assert.equal(globToRegex("[abc]"), "^[abc]$");
        assert.equal(globToRegex("[a-z]"), "^[a-z]$");
        assert.equal(matches("[abc]", "b"), true);
        assert.equal(matches("[abc]", "d"), false);
        assert.equal(matches("[a-c]x", "bx"), true);
    });

    it("translates both [!…] and [^…] into a negated class", () => {
        assert.equal(globToRegex("[!abc]"), "^[^abc]$");
        assert.equal(globToRegex("[^abc]"), "^[^abc]$");
        assert.equal(matches("[!abc]", "d"), true);
        assert.equal(matches("[!abc]", "a"), false);
    });

    it("escapes a backslash inside a class", () => {
        // Pattern [a\b] is the set {a, \, b}.
        assert.equal(globToRegex("[a\\b]"), "^[a\\\\b]$");
        assert.equal(matches("[a\\b]", "\\"), true);
        assert.equal(matches("[a\\b]", "a"), true);
        assert.equal(matches("[a\\b]", "c"), false);
    });

    it("treats an unclosed [ as a literal", () => {
        assert.equal(globToRegex("[abc"), "^\\[abc$");
        assert.equal(matches("[abc", "[abc"), true);
    });

    it("regression: escapes a literal ] that opens the class body", () => {
        // A `]` directly after `[` or `[^` is special in JS regex: `[]` is an
        // empty (never-matching) class and `[^]` matches ANY character. So
        // [!]a] produced ^[^]a]$, which matched "Xa]" instead of a single
        // character outside {], a}.
        assert.equal(globToRegex("[!]a]"), "^[^\\]a]$");
        assert.equal(matches("[!]a]", "Xa]"), false, "must not swallow two characters");
        assert.equal(matches("[!]a]", "b"), true);
        assert.equal(matches("[!]a]", "]"), false, "']' is excluded");
        assert.equal(matches("[!]a]", "a"), false, "'a' is excluded");
        // The non-negated twin must still match its own members.
        assert.equal(matches("[]a]", "]"), true);
        assert.equal(matches("[]a]", "a"), true);
        assert.equal(matches("[]a]", "b"), false);
    });
});

describe("brace expansion", () => {
    it("expands a brace list into alternatives", () => {
        assert.equal(globToRegex("a{b,c}d"), "^abd$|^acd$");
        assert.equal(matches("a{b,c}d", "abd"), true);
        assert.equal(matches("a{b,c}d", "acd"), true);
        assert.equal(matches("a{b,c}d", "ad"), false);
    });

    it("handles nested braces", () => {
        assert.equal(globToRegex("{a,b{c,d}}"), "^a$|^bc$|^bd$");
        assert.equal(matches("{a,b{c,d}}", "bd"), true);
        assert.equal(matches("{a,b{c,d}}", "b"), false);
    });

    it("keeps an unbalanced { literal", () => {
        assert.equal(globToRegex("{a,b"), "^\\{a,b$");
        assert.equal(matches("{a,b", "{a,b"), true);
    });

    it("expands braces inside a larger pattern", () => {
        assert.equal(matches("src/*.{js,ts}", "src/x.ts"), true);
        assert.equal(matches("src/*.{js,ts}", "src/x.rs"), false);
        assert.equal(matches("src/*.{js,ts}", "src/a/b.js"), false, "* still stops at /");
    });
});

describe("metacharacter escaping", () => {
    it("escapes regex metacharacters so they stay literal", () => {
        assert.equal(globToRegex("a.b"), "^a\\.b$");
        assert.equal(globToRegex("a+b"), "^a\\+b$");
        assert.equal(globToRegex("(x)"), "^\\(x\\)$");
        assert.equal(globToRegex("$^"), "^\\$\\^$");
        assert.equal(globToRegex("a/b"), "^a\\/b$");
    });

    it("treats a literal dot as a dot, not as any character", () => {
        assert.equal(matches("a.b", "a.b"), true);
        assert.equal(matches("a.b", "axb"), false);
    });
});
