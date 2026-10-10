# AGENTS.md

Guidance for agents working inside `copyous@local` — a local maintenance fork of
Copyous (baseline 2.0.1), published as `SHADE-glitch/copyous`.

Before debugging anything measured, look up the page in [MAINTENANCE.md](MAINTENANCE.md)'s
"question → file" table: it is a router, and the operational knowledge (log reading, regression
criteria, windowing gates, database discipline, the platform matrix, the current baseline numbers)
lives one page each under `docs/maintenance/`. One fact has one owner; this file states the rules
that must not be broken, not the measurements.

> **Shared standard.** Root file names, the process-draft location (`docs/reports/`), the
> `CHANGELOG` entry format, CI version pinning and entry commands, the test entry command, and
> the runtime ignore list are defined once in the machine-wide `STANDARD.md` (outside this
> repository) and are not restated here.
>
> **Push over SSH, never HTTPS.** Verify `git remote get-url --push origin` starts with `git@`
> before pushing; if it starts with `https://`, fix it first — never push over HTTPS.

## Critical Rules
- **NEVER run `gnome-extensions install` or `gnome-extensions pack` from within this repo directory.** The install tool follows symlinks and will wipe the source directory contents.
- **Do not load ESModules via legacy `imports`** (e.g. `imports.ui.main` throws `SyntaxError` in GNOME 45+). Use static `import` or dynamic `await import()`.
- **Do not reassign ESModule exports directly.** Monkeypatch mutable prototypes instead.
- **GJS constraint**: no `fetch`/`URLSearchParams` inside the shell process. Use `Soup.Session` + `GLib.Bytes`.
- **`disable` + `enable` does NOT reimport modules.** A cached ESModule keeps its old code, so a change to a `lib/*.js` file only takes effect after a **log out / log in**. Never claim a reload activated an edit.
- **A test never writes the maintainer's real directories.** `test/headless/up.sh` *asserts*
  the redirect is a real directory (not a symlink back into `~/.config`), and `run.sh` hashes
  `~/.config/copyous@local` before and after each batch and fails the whole run on any change.
  `test/prefs/run.sh` cannot redirect, because the settings process reads the real data dir by
  design, so it fingerprints instead: content + metadata for `~/.config/copyous@local`, **file
  names only** for `~/.local/share/copyous@local` (normal use rewrites `clipboard.db-wal` in
  there, so a size comparison would blame the test for the user's clipboard).
  A probe that overwrites one of the user's files has to restore it *and assert the restore*.
  Why this is a rule and not a hint: on 2026-10-09 probe 08's synthetic `{}` went through a
  symlinked config root into the live file and silently disabled the item menu for 1.5 hours.
- **Parsable is not valid.** Anything the user can edit on disk (`actions.json` above all) is
  checked for *shape* at the load boundary, not just for JSON syntax: consumers do
  `config.actions.map(...)`, so a file that parses and lacks the field kills the feature while
  printing only `Unhandled promise rejection` -- a form neither `CRITICAL` nor `JS ERROR` matches.
  Recoverable conditions are logged with `logger.warn`; `logger.error` renders as a shell
  CRITICAL and turns the health gate permanently red. Measured 2026-10-10, whole class swept:
  nine sites were downgraded (absent Gda typelib, media-duration probe, file info and file
  preview build, two image-notification decodes, two link-metadata fetches, stylesheet load,
  a lost chmod). The remaining `logger.error` calls all meet one bar: **the user's database or
  data is actually damaged.** Beware the grep that finds them: `\berror\(` does not match
  `.catch(error)`, and deleting that binding killed `enable()` -- the L1 harness printed
  `deferred enable failed: ReferenceError: error is not defined` while L0 could not see it at all.
- **Nothing the user copied may reach the journal.** The clipboard is stored verbatim, so a log
  line that prints an `entry`, or an action's stderr, writes their text into
  `/var/log/journal` for whoever reads logs from now on -- actions get the entry content on
  stdin, so their output can carry a password back. Log the *type and id*, never the content.
  Found at two sites on 2026-10-10 (`clipboardDialog`: `Unknown item type` + the whole entry;
  `actionMenu`: the action's stderr).
- **A gate has to count the class, not the three words we happened to know.** GLib's own C-side
  failures reach the journal with **no "CRITICAL" anywhere in the message body** (level and
  domain are journald fields: `PRIORITY=4`, `GLIB_DOMAIN=GLib-GObject`), so a word-based gate
  reads a clean zero over them. Measured 2026-10-10: 27 `g_object_unref: assertion
  'G_IS_OBJECT (object)' failed` lines across boots while every gate in this repo printed 0.
  `test/headless/run.sh` now counts `assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL`
  with the same three-way attribution as the disposed count, and only the near-our-frames tier
  fails the run. The shapes and the attribution result are `docs/maintenance/reading-the-log.md`'s.
- **One instrument fault must not be allowed to become eight product failures.** A timed-out probe
  leaves its nested shell blocked inside a C call: it never reaches a signal handler, so SIGTERM is
  ignored and the shell keeps holding mutter's Wayland lock -- every later session in the run then
  dies at `Failed to create_socket` and prints `shell never answered Eval`. Teardown must escalate
  to SIGKILL and re-check, and a teardown that still fails **stops the run**, because continuing
  only manufactures red that has nothing to do with the code. Same class: a probe prefix matching
  two files builds a nonexistent eval path, so `run.sh` rejects it before `up.sh`, not after
  450 seconds of waiting. Numbers and the paired controls: `docs/maintenance/verification.md`.
- **A destructive check restores the bytes it read *this run*, never a cached snapshot.** The teeth harness for
  the doc-equivalence proof kept its "pristine" copy in `/tmp` and wrote that back after every case, so it
  silently rolled back every later edit to the script under test -- two registry declarations and one exemption
  clause on 2026-10-10 -- while printing `restored byte-identical: True`, because what it compared against was
  its own stale copy. Read the pristine text from the file at run start, restore to *that*, and assert after the
  whole run that the file is unchanged. Same family: `sh -n` on this box did not report a dash syntax error in a
  multi-line `for` list, so a batch script is only proven once it actually starts.
- **No shell-side file may statically `import` a typelib the shell does not guarantee.** The
  guaranteed set is what the shell's own modules import (`gresource list + extract` over
  `libshell-NN.so`), not a guess: Gda, GSound and Gst are outside it. A static import of an
  absent typelib throws *while the module is being resolved*, so the extension does not lose a
  feature -- it fails to load. Load those namespaces with `await import()` inside the function
  that needs them and degrade (`lib/database/entryTracker.js` for Gda, `lib/ui/components/contentInfo.js`
  for Gst are the two shapes). Guard: `test/shell-internals.test.js` / `node scripts/shell-internals.mjs`;
  measured 2026-10-09, provoked on the pre-fix tree (`FAIL: gi://Gst ... not guaranteed`, exit 2).
- **Idle CPU can only be measured by differencing one process.** Whole-shell CPU% is not
  attributable (the real session idles at tens of percent, none of it ours).
  `./test/headless/idle-cost.sh` samples `/proc/<pid>/stat` counters -- a counter, so no
  sampling aliasing, but 1 tick = 10 ms, and **every measured window needs a discarded window of
  the same length before it** or the bare-shell reading is inflated by deferred boot work and the
  delta comes out negative. Verdict line is `NOT MEASURABLE` or `MEASURABLE`, never a silent zero.
- **Settings copy is machine-checked.** `./test/prefs/run.sh` has to stay green: every group has
  a title, every row that changes a setting has a subtitle, every icon-only button has a tooltip.
  A new row without a subtitle is a failing change, not a follow-up task.
- **Every setting with a control has a way back to its default.** `makeResettable(row, settings,
  'key')` puts a visible undo button on the row that owns the value, and `npm test` (or
  `node scripts/settings-coverage.mjs` directly) fails the tree if a bound key has no reset, if a
  key name is not in the schema, or if a bind passes the key as a variable -- that shape is
  invisible to the audit, so it is refused rather than skipped. For a value bound on a sub-page
  (`Adw.NavigationPage`, which has no `add_suffix`), attach the button to the row that *opens*
  that page; attaching it to the page itself stops the whole settings window from building.
  Measured 2026-10-09: 79 of 79 controls covered; `paste-on-copy` has no row on purpose --
  `migrateSettings()` folds it into `swap-copy-shortcut` and resets it.
- **Keep the pure modules free of `gi://` / `resource://` imports.** `lib/common/color.js`, `lib/common/glob.js`, `lib/common/settings.js` and `lib/misc/actor.js` are the only four modules Node can load; adding a platform import to any of them silently kills `npm test`.

## Tests
- **Run `npm test`** (`node --test test/*.test.js`) after editing a pure module. No gjs, no dependencies, no build step.
- `npm run test:coverage` — the same pure suites under Node's built-in coverage (`--experimental-test-coverage`). The report also lists the test files; read the `lib/` and `scripts/*.mjs` rows for the product modules. A **reading, not a gate** (no threshold); the shell-bound `lib/{database,preferences,ui}` and `extension.js` never appear.
- Exactly five modules are loadable outside the shell, so exactly those can be unit-tested. Four are covered:

  | module | suite |
  |---|---|
  | `lib/common/color.js` | `test/color.test.js` |
  | `lib/common/glob.js` | `test/glob.test.js` |
  | `lib/common/settings.js` | `test/settings.test.js` |
  | `lib/misc/actor.js` | `test/actor.test.js` |

  One more suite, `test/repo.test.js`, guards the repository instead of the code: the two-file bilingual
  README pair has the same `##` count and both open with the language switcher; **no markdown anywhere in
  the tree uses task checkboxes** (it walks the *working tree*, so untracked files under the gitignored
  `docs/reports/` can fail it too -- write reports with ordered lists or tables, never `- [ ]`); every
  file under `docs/maintenance/` is linked from the `MAINTENANCE.md` router table, because an unlinked
  handbook page does not exist; and **no file outside `docs/reports/` cites a section number**, since the
  handbook is a router now and its sections have no numbers to cite. Both new guards were provoked before
  they were written down, and the `docs/reports/` exemption was tested in the other direction: a section
  number added to a dated report must stay green. `INVARIANTS.md` (both languages) additionally may hold
  **no line taken verbatim from `CHANGELOG.md`** and must name `node scripts/check-log.mjs --invariants`:
  the point of that file is that it is a pointer, and the only way to keep a pointer file from turning
  into a second copy is to check it for copies.

  A fourth suite, `test/shell-internals.test.js`, is the machine-free half of the typelib rule above.
  It fails if a shell-side file statically imports a namespace outside the guaranteed set, if a
  dynamically-loaded namespace also appears statically, or if the inventory has silently emptied.
  The third rule (the literal set against the installed shell) prints `INERT` where no GNOME Shell
  exists, and the test asserts on that word instead of reading silence as green.

  A third guard, `test/settings-coverage.test.js`, runs `node scripts/settings-coverage.mjs` and fails
  if the settings window no longer matches the schema. It is the only check that can see a missing
  *affordance*: `makeResettable(row, settings, 'typoed-key')` returns the row untouched -- no button, no
  error, no runtime symptom -- and a setting shipped without a way back looks perfectly healthy. Run the
  script directly for the per-key report (`node scripts/settings-coverage.mjs`; verdict on the last
  line). Its four FAIL branches were each provoked, and it also fails on a `bind` whose key is a
  variable, because that shape would escape the audit.

  The fifth loadable module, `thirdparty/qrcodegen.js`, is vendored upstream code and is deliberately not tested. Everything else in `lib/` imports `gi://` and cannot be tested under Node — for that surface there is `test/headless/`, which boots an isolated `gnome-shell --headless` (private dbus, `GSETTINGS_BACKEND=memory`, scratch `XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_CONFIG_HOME`, a synthetic DB fixture) and drives it with probes:

  ```sh
  ./test/headless/run.sh all        # 3 configs x 13 probes = 39 sessions (~30s each)
  ./test/headless/run.sh live 01    # one probe, the maintainer's real config
  ```

  Configs are `configs/{live,unwindowed,horizontal}.json`; results land in `/tmp/copyous-harness/out`. What the harness isolates, and what it cannot, is `docs/maintenance/verification.md`'s job to say -- the rule above is the short version, and it is the one that has actually bitten.
- **`lib/preferences/**` is verified without logging out**, because the settings dialog runs in its own
  `gjs` process: `./test/prefs/run.sh` builds the real window under Xvfb with
  `GSETTINGS_BACKEND=memory`, walks the widget tree and asserts the copy invariants. The traps are
  documented where they are handled -- the `GI_TYPELIB_PATH` ordering and the exit-code problem in
  `test/prefs/run.sh`'s own header, `Adw.Row` missing from the typelib in
  `docs/maintenance/verification.md` (L0b). That section also records why `run.sh` treats a missing
  `# N/M checks passed` line as NOT VERIFIED rather than as a pass.
- **Provoking an asynchronous code path means waiting for the state *you wrote* to change**, not
  for the expected value to appear: right after a write, the previous good value still answers any
  question about it, and probe 12's first version reported 7/7 green on code with the guard
  removed for exactly that reason. Write a distinguishable marker, then wait for it to disappear.
- **Read `docs/maintenance/reading-the-log.md` before debugging a performance or lifecycle question** (and `docs/maintenance/baseline.md` for the numbers to compare against). `MAINTENANCE.md` itself is only a router. It records which log fields are valid regression criteria (`TTI (main loop free)`, the CRITICAL count) and which are noise (`open(): show` scatters 2.65x within one boot; first-open `idle after redraw` is polluted by reveal gap), plus how to get the *real* session shell's PID without grabbing a leftover headless one.
- **`color.js` needs a shim.** Its `Color` constructor calls `Math.clamp`, which Node does not provide; `test/color.test.js` installs the shell's own one-line definition before building any `Color`, and any new test that constructs one needs the same. Why the symbol exists in the shell at all is a platform fact and lives in `docs/maintenance/compatibility-matrix.md`.
- Everything the modules touch is duck-typed, so fake the collaborators (a fake `Gio.Settings`, a fake widget, a fake actor tree) rather than reaching for the real classes.
- When fixing a bug, add a regression test that **fails against the pre-fix code** first.
- Test files carry `SPDX-License-Identifier: GPL-3.0-or-later` (the repo licence — note this differs from the `macos-dock@local` sibling, which is GPL-2.0-or-later).

## CI
- `.github/workflows/ci.yml` runs on every `push` and `pull_request` (`ubuntu-latest`, Node 20). It runs exactly two commands, in order: `npm test` then `npm run check:log`.
- Both must stay **green**. There is no build step and no dependency install — a failure means a broken test or a broken record, never a flaky toolchain.
- The checkout must fetch **full history** (`fetch-depth: 0`): `check:log` walks `git log <anchor>..HEAD` back to the coverage anchor, which a default shallow clone cannot resolve.
- Action versions are pinned (`actions/checkout@v4`, `actions/setup-node@v4`); bump them deliberately, not as drive-by churn.
- **Keep CI in step with the code.** Update `.github/workflows/ci.yml` in the *same change* that
  makes it stale — never as a later cleanup.
- **New or renamed tests need no CI edit** as long as CI runs the suite command (`npm test`); it
  does, so it picks them up automatically. Only touch CI if the *command itself* changes.
- **Environment changes** — a new dependency, a Node version bump, or a new system tool — mean
  updating the workflow's setup/install steps.
- **Renamed or moved code**: `check:log` watches a declared list (`CODE_PATHS` in
  `scripts/check-log.mjs` — currently `extension.js`, `lib/`). If a watched path moves, update that
  list; the check goes red until you do.
- **After a refactor**, confirm CI still exercises the real code and the declared paths still cover
  it. A green CI that no longer touches the changed code is worse than a red one.
- **A new verification tier** (headless / live) — decide explicitly whether CI runs it; do not add it silently.
- If what CI runs changes, update this section too. CI is a signal, not a gate, until branch protection
  is enabled — read the result after every push.

## Known issues (recorded, not fixed)
- `new Color(space, c1, c2, c3)` with no alpha argument leaves `alpha = NaN` (`Math.clamp(undefined, 0, 1)`), so `toString()` emits `rgb(10 20 30 / NaN)`. No current caller omits alpha, so this is latent rather than live — but any new caller must pass one.

## Docs & Commits
- The Chinese README is the **authoritative divergence list**; the English one deliberately points at it instead of duplicating it. Do not "fix" that asymmetry.
- **Do not touch the `Credits & Attribution` / `Changes vs upstream (2.0.1)` sections** unless the change actually affects attribution or the upstream diff.
- Commit code first, docs in a separate commit. Commit messages use **Chinese subjects with English conventional-commit prefixes** (`fix:` / `perf:` / `test:` / `docs:` / `chore:`).
- Live logs: `journalctl -f -o cat /usr/bin/gnome-shell`

## Release / version
- The version lives in `metadata.json` as two fields: `version` (an integer GNOME compares to detect an available update) and `version-name` (the human-readable label shown to users).
- Bump `version` on **every release that changes a shipped file** — GNOME only offers the update when the integer increases, so forgetting it silently strands users on the old build.
- Bump `version-name` only when the user-facing label actually changes; it currently reads `2.0.1`, the upstream baseline this fork is frozen at, and stays there until the fork adopts its own numbering.

## Recording conventions
- Behaviour changes land in `CHANGELOG.md` as `D-###` entries; ids are monotonic and **never
  reused**, so a gap means an entry was deleted — `check:log` treats that as a failure, not a cleanup.
- `kind` ∈ `fix` | `perf` | `taste` | `guard` | `revert` | `chore`, cut by **who may demand a revert**:
  dropping it makes a bug → `fix`; dropping it only re-introduces measurable degradation → `perf`;
  dropping it merely makes me less happy → `taste` (zero obligation, discardable wholesale on an
  upgrade); it changes no behaviour and only detects drift → `guard`; it withdraws earlier work →
  `revert`; it is cleanup owed nothing either way → `chore`. A commit that is two things at once
  becomes two entries citing the same hash — done so
  here for `0c463b2` (D-010 perf / D-011 fix) and `f0761fe` (D-014 fix / D-015 guard).
- `CHANGELOG.md` is a machine-checked **index**, not a second divergence list. The curated
  narrative stays in `README.zh-CN.md` (single authoritative copy); neither file restates the other.
- An entry is an assertion **as of its commit**, not current state: never re-verify an old entry,
  never hand-copy an aggregate count into it — `check:log` and `git rev-list --count` print them.
- Known-but-not-fixed issues do **not** go in `CHANGELOG.md` (they have no commit). They live in
  "Known issues (recorded, not fixed)" above, `docs/maintenance/open-items.md` and the README's deliberately-unfixed ledger.
- `Symptom` names the mechanism, never the session: this extension holds the user's clipboard, so
  no copied text, file path, URL or application name from a real desktop may appear. `D-012` is the
  reason to be strict — untrusted user content already reaches the database layer.
- A window containing zero entries is a failure, not a pass.
- Run `npm run check:log` before committing docs (bare `node scripts/check-log.mjs` works too).
