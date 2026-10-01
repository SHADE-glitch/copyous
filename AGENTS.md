# AGENTS.md

Guidance for agents working inside `copyous@local` — a local maintenance fork of
Copyous (baseline 2.0.1), published as `SHADE-glitch/copyous`.

## Critical Rules
- **NEVER run `gnome-extensions install` or `gnome-extensions pack` from within this repo directory.** The install tool follows symlinks and will wipe the source directory contents.
- **Do not load ESModules via legacy `imports`** (e.g. `imports.ui.main` throws `SyntaxError` in GNOME 45+). Use static `import` or dynamic `await import()`.
- **Do not reassign ESModule exports directly.** Monkeypatch mutable prototypes instead.
- **GJS constraint**: no `fetch`/`URLSearchParams` inside the shell process. Use `Soup.Session` + `GLib.Bytes`.
- **`disable` + `enable` does NOT reimport modules.** A cached ESModule keeps its old code, so a change to a `lib/*.js` file only takes effect after a **log out / log in**. Never claim a reload activated an edit.
- **Keep the pure modules free of `gi://` / `resource://` imports.** `lib/common/color.js`, `lib/common/glob.js`, `lib/common/settings.js` and `lib/misc/actor.js` are the only four modules Node can load; adding a platform import to any of them silently kills `npm test`.

## Tests
- **Run `npm test`** (`node --test test/*.test.js`) after editing a pure module. No gjs, no dependencies, no build step.
- Exactly five modules are loadable outside the shell, so exactly those can be unit-tested. Four are covered:

  | module | suite |
  |---|---|
  | `lib/common/color.js` | `test/color.test.js` |
  | `lib/common/glob.js` | `test/glob.test.js` |
  | `lib/common/settings.js` | `test/settings.test.js` |
  | `lib/misc/actor.js` | `test/actor.test.js` |

  The fifth, `thirdparty/qrcodegen.js`, is vendored upstream code and is deliberately not tested. Everything else in `lib/` imports `gi://` and cannot be tested under Node — for that surface there is `test/headless/`, which boots an isolated `gnome-shell --headless` (private dbus, `GSETTINGS_BACKEND=memory`, scratch `XDG_DATA_HOME`, a synthetic DB fixture) and drives it with probes:

  ```sh
  ./test/headless/run.sh all        # 3 configs x 5 probes, ~8 min
  ./test/headless/run.sh live 01    # one probe, the maintainer's real config
  ```

  Configs are `configs/{live,unwindowed,horizontal}.json`; results land in `/tmp/copyous-harness/out`. It never touches the live `clipboard.db` or the real dconf.
- **Read `MAINTENANCE.md` before debugging a performance or lifecycle question.** It records which log fields are valid regression criteria (`TTI (main loop free)`, the CRITICAL count) and which are noise (`open(): show` scatters 2.65x within one boot; first-open `idle after redraw` is polluted by reveal gap), plus how to get the *real* session shell's PID without grabbing a leftover headless one.
- **`color.js` needs a shim.** Its `Color` constructor calls `Math.clamp`, which is not a JavaScript built-in — GNOME Shell 50.1 injects it (`/usr/lib/gnome-shell/libshell-18.so`). `test/color.test.js` installs the shell's own one-line definition before building any `Color`; any new test that constructs one needs the same shim.
- Everything the modules touch is duck-typed, so fake the collaborators (a fake `Gio.Settings`, a fake widget, a fake actor tree) rather than reaching for the real classes.
- When fixing a bug, add a regression test that **fails against the pre-fix code** first.
- Test files carry `SPDX-License-Identifier: GPL-3.0-or-later` (the repo licence — note this differs from the `macos-dock@local` sibling, which is GPL-2.0-or-later).

## Known issues (recorded, not fixed)
- `new Color(space, c1, c2, c3)` with no alpha argument leaves `alpha = NaN` (`Math.clamp(undefined, 0, 1)`), so `toString()` emits `rgb(10 20 30 / NaN)`. No current caller omits alpha, so this is latent rather than live — but any new caller must pass one.

## Docs & Commits
- `README.md` and `README.zh-CN.md` are a **two-file bilingual pair** — edit both together.
- The Chinese README is the **authoritative divergence list**; the English one deliberately points at it instead of duplicating it. Do not "fix" that asymmetry.
- **Do not touch the `Credits & Attribution` / `Changes vs upstream (2.0.1)` sections** unless the change actually affects attribution or the upstream diff.
- Commit code first, docs in a separate commit. Commit messages use **Chinese subjects with English conventional-commit prefixes** (`fix:` / `perf:` / `test:` / `docs:` / `chore:`).
- Live logs: `journalctl -f -o cat /usr/bin/gnome-shell`
