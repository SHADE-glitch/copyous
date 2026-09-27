// SPDX-License-Identifier: GPL-3.0-or-later
// © SHADE-glitch — tests for settings.js, part of copyous@local.
//
// settings.js has no imports at all, so it runs under plain Node with no gjs and
// no dependencies:
//
//   npm test
//
// Everything it touches (Gio.Settings and a bound widget) is duck-typed, so the
// fakes below stand in for both. The assertions pin the two contracts that are
// easy to get wrong: a binding must release BOTH directions when its widget is
// destroyed, and a settings migration must never override an explicit user
// choice.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    ChildKeys,
    Position,
    SettingsTypes,
    bind_enum,
    bind_flags,
    migrateSettings,
} from "../lib/common/settings.js";

/** Minimal stand-in for Gio.Settings. */
function fakeSettings({ enum: enumValue = 0, flags: flagsValue = 0, userValues = {} } = {}) {
    let nextId = 1;
    return {
        handlers: new Map(),
        connectLog: [],
        disconnected: [],
        enumWrites: [],
        flagWrites: [],
        booleanWrites: [],
        resets: [],
        userValues: { ...userValues },
        enumValue,
        flagsValue,
        get_enum() {
            return this.enumValue;
        },
        set_enum(key, value) {
            this.enumValue = value;
            this.enumWrites.push([key, value]);
        },
        get_flags() {
            return this.flagsValue;
        },
        set_flags(key, value) {
            this.flagsValue = value;
            this.flagWrites.push([key, value]);
        },
        get_user_value(key) {
            return Object.hasOwn(this.userValues, key)
                ? { get_boolean: () => this.userValues[key] }
                : null;
        },
        set_boolean(key, value) {
            this.booleanWrites.push([key, value]);
            this.userValues[key] = value;
        },
        reset(key) {
            this.resets.push(key);
            delete this.userValues[key];
        },
        connect(signal, callback) {
            const id = nextId++;
            this.handlers.set(id, { signal, callback });
            this.connectLog.push({ id, signal });
            return id;
        },
        disconnect(id) {
            this.disconnected.push(id);
        },
        emit(signal) {
            for (const { signal: name, callback } of this.handlers.values())
                if (name === signal) callback();
        },
    };
}

/** Minimal stand-in for a GObject widget bound to a settings key. */
function fakeWidget(property, value) {
    let nextId = 1;
    return {
        handlers: new Map(),
        connectLog: [],
        disconnected: [],
        setCalls: [],
        [property]: value,
        set_property(name, newValue) {
            this.setCalls.push([name, newValue]);
            this[name] = newValue;
        },
        connect(signal, callback) {
            const id = nextId++;
            this.handlers.set(id, { signal, callback });
            this.connectLog.push({ id, signal });
            return id;
        },
        disconnect(id) {
            this.disconnected.push(id);
        },
        emit(signal) {
            for (const { signal: name, callback } of this.handlers.values())
                if (name === signal) callback();
        },
    };
}

/** The id a fake handed back for the first connect of `signal`. */
const idOf = (object, signal) => object.connectLog.find((c) => c.signal === signal).id;

describe("SettingsTypes", () => {
    const KNOWN_TYPES = new Set(["boolean", "int", "double", "string", "enum", "flags", "strv"]);

    it("uses only the known type names", () => {
        const walk = (node, path) => {
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === "string")
                    assert.ok(KNOWN_TYPES.has(value), `${path}${key}: unknown type ${value}`);
                else assert.equal(typeof value, "object", `${path}${key} must be a type or a group`);
                if (value && typeof value === "object") walk(value, `${path}${key}.`);
            }
        };
        walk(SettingsTypes, "");
    });

    it("has a group for every ChildKeys entry", () => {
        for (const childKey of Object.values(ChildKeys))
            assert.equal(typeof SettingsTypes[childKey], "object", `${childKey} needs a group`);
    });

    it("does not collide a child group with a top-level scalar key", () => {
        const scalars = Object.entries(SettingsTypes)
            .filter(([, value]) => typeof value === "string")
            .map(([key]) => key);
        for (const childKey of Object.values(ChildKeys))
            assert.equal(scalars.includes(childKey), false, `${childKey} is both a scalar and a group`);
    });
});

describe("Position", () => {
    it("shares values across the vertical and horizontal axes by design", () => {
        // One enum backs two combo rows: vertical is Top/Center/Bottom and
        // horizontal is Left/Center/Right, so the shared members must agree.
        assert.equal(Position.Top, Position.Left);
        assert.equal(Position.Bottom, Position.Right);
        assert.equal(Position.Top, 0);
        assert.equal(Position.Center, 1);
        assert.equal(Position.Bottom, 2);
        assert.equal(Position.Fill, 3);
        assert.equal(new Set(Object.values(Position)).size, 4, "four distinct positions");
    });
});

describe("bind_enum", () => {
    it("seeds the widget from the settings value", () => {
        const settings = fakeSettings({ enum: 2 });
        const widget = fakeWidget("selected", 0);

        bind_enum(settings, "clipboard-orientation", widget, "selected");

        assert.deepEqual(widget.setCalls, [["selected", 2]]);
    });

    it("pushes a settings change into the widget", () => {
        const settings = fakeSettings({ enum: 0 });
        const widget = fakeWidget("selected", 0);
        bind_enum(settings, "k", widget, "selected");

        settings.enumValue = 3;
        settings.emit("changed::k");

        assert.equal(widget.selected, 3);
    });

    it("writes a widget change back to the settings key", () => {
        const settings = fakeSettings({ enum: 0 });
        const widget = fakeWidget("selected", 0);
        bind_enum(settings, "k", widget, "selected");

        widget.selected = 4;
        widget.emit("notify::selected");

        assert.deepEqual(settings.enumWrites, [["k", 4]]);
    });

    it("ignores a null property so a torn-down widget cannot clear the key", () => {
        const settings = fakeSettings({ enum: 0 });
        const widget = fakeWidget("selected", 0);
        bind_enum(settings, "k", widget, "selected");

        widget.selected = null;
        widget.emit("notify::selected");

        assert.deepEqual(settings.enumWrites, []);
    });

    it("releases both connections when the widget is destroyed", () => {
        // Without this the settings connection outlives the widget and keeps the
        // closure (and the widget) alive for the rest of the session.
        const settings = fakeSettings({ enum: 0 });
        const widget = fakeWidget("selected", 0);
        bind_enum(settings, "k", widget, "selected");

        widget.emit("destroy");

        assert.deepEqual(settings.disconnected, [idOf(settings, "changed::k")]);
        assert.deepEqual(widget.disconnected, [idOf(widget, "notify::selected")]);
    });
});

describe("bind_flags", () => {
    it("seeds the widget, pushes changes down and writes changes back", () => {
        const settings = fakeSettings({ flags: 0 });
        const widget = fakeWidget("selected", 0);

        bind_flags(settings, "file-preview-types", widget, "selected");
        assert.deepEqual(widget.setCalls, [["selected", 0]]);

        settings.flagsValue = 5;
        settings.emit("changed::file-preview-types");
        assert.equal(widget.selected, 5);

        widget.selected = 3;
        widget.emit("notify::selected");
        assert.deepEqual(settings.flagWrites, [["file-preview-types", 3]]);
    });

    it("ignores a null property", () => {
        const settings = fakeSettings({ flags: 0 });
        const widget = fakeWidget("selected", 0);
        bind_flags(settings, "k", widget, "selected");

        widget.selected = null;
        widget.emit("notify::selected");

        assert.deepEqual(settings.flagWrites, []);
    });

    it("releases both connections when the widget is destroyed", () => {
        const settings = fakeSettings({ flags: 0 });
        const widget = fakeWidget("selected", 0);
        bind_flags(settings, "k", widget, "selected");

        widget.emit("destroy");

        assert.deepEqual(settings.disconnected, [idOf(settings, "changed::k")]);
        assert.deepEqual(widget.disconnected, [idOf(widget, "notify::selected")]);
    });
});

describe("migrateSettings", () => {
    it("inverts a legacy paste-on-copy value into swap-copy-shortcut", () => {
        const settings = fakeSettings({ userValues: { "paste-on-copy": true } });

        migrateSettings(settings);

        assert.deepEqual(settings.booleanWrites, [["swap-copy-shortcut", false]]);
    });

    it("does not migrate when the legacy key has no user value", () => {
        const settings = fakeSettings();

        migrateSettings(settings);

        assert.deepEqual(settings.booleanWrites, []);
        assert.deepEqual(settings.resets, ["paste-on-copy"]);
    });

    it("lets an explicit choice on the new key win", () => {
        // A downgrade can re-introduce paste-on-copy; the user's own setting on
        // the replacement key must survive it.
        const settings = fakeSettings({
            userValues: { "paste-on-copy": true, "swap-copy-shortcut": true },
        });

        migrateSettings(settings);

        assert.deepEqual(settings.booleanWrites, []);
    });

    it("always resets the legacy key", () => {
        const settings = fakeSettings({ userValues: { "paste-on-copy": false } });

        migrateSettings(settings);

        assert.deepEqual(settings.resets, ["paste-on-copy"]);
        assert.equal(Object.hasOwn(settings.userValues, "paste-on-copy"), false);
    });

    it("is idempotent", () => {
        const settings = fakeSettings({ userValues: { "paste-on-copy": true } });

        migrateSettings(settings);
        const afterFirst = [...settings.booleanWrites];
        migrateSettings(settings);

        assert.deepEqual(settings.booleanWrites, afterFirst, "a second run writes nothing new");
        assert.deepEqual(settings.resets, ["paste-on-copy", "paste-on-copy"]);
    });
});
