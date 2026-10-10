# Three-layer verification: what to run, in what order, where the isolation boundary is

Every verification entry point before and after a code change is in this file: L0 static, L0b settings window (**no logout**), L1 headless three arms, L2 real session, plus the isolated harness's hard boundaries, environment-residue cleanup, and "what headless can and cannot prove".

> **Origin**: section 1 (L0/L0b/L1/L2), section 3, and section 10, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split). The move was a verbatim copy;
> only the relative links were rewritten for the new directory level. This file is the sole owner of these facts; do not restate them elsewhere.


## 1. Three-layer verification

### L0 static (no shell needed, always run first)

```sh
for f in $(find . -name '*.js' -not -path './.git/*'); do node --check "$f" || echo "FAIL $f"; done
node --test test/*.test.js          # `npm test` now works too (measured 2026-10-09); either is fine
```

Expected: all 107 files pass; `tests 103 / pass 103 / fail 0`.
These two numbers grow with the code, so do not use them as criteria — the criterion is **fail 0**. To confirm on the spot, run
`find . -name '*.js' -not -path './.git/*' | wc -l` and `node --test test/*.test.js | grep -E '^# (tests|fail)'`.

**Settings-coverage gate** (a cross-check of schema ↔ settings window, purely static, does not touch dconf):

```sh
node scripts/settings-coverage.mjs   # the criterion is on the last line: RESULT: PASS / FAIL
```

It aligns the 82 keys of `schemas/*.gschema.xml` with the wiring in `lib/preferences/**`, and all four red modes have been poisoned one by one to prove
they fire: a missing `makeResettable` call, a misspelled key name, a `bind` key name turned into a variable (which also closes the detector's only
escape route), and deleting the `bind` while keeping the reset button. `test/settings-coverage.test.js` wires it into
`npm test`, so missing a restore entry cannot slip through by "forgetting to run that command".

`-- keys with no widget at all in prefs: 1` is **known and legitimate**: `paste-on-copy` is deprecated,
and `migrateSettings()` inverts its meaning into `swap-copy-shortcut` and then `reset`s it, so it should have no row.
Another 2 keys (`in-memory-database`, `database-backend`) are driven by a button rather than a control, and are reported separately.

**Wiring consistency** (do this after a rename / method deletion):

```sh
./test/headless/run.sh live 07          # probe 07, about 1 minute per session
```

What was written here before was a `grep "\.addItem(\|\.focusChild(\|\.nextFocus("` asserting "expected: no output".
**It has been disproven, do not run it again**: the `addItem` removed by the container refactor collided in name with `SearchEntry`'s own private `addItem`
(the row-build function of the type-filter dropdown), so that check **permanently false-alarmed on 9 items**; and the "list of deleted method names" form itself
also rots as the code evolves — either it gets ignored, or it gets "fixed" by deleting working code to make it green.
(`SearchEntry`'s private method has since been renamed `addFilterRow`, and the collision is gone; but the guard should not depend on a rename.)

Probe 07 was replaced with one that **derives its scope from the code itself**: from the source it takes `this._x = new Cls(` and pairs it with `this._x.m(`
in the same file, then resolves `m` on the **live object** — so methods inherited from St/Clutter/GObject are naturally correct, with no allowlist needed;
categories with no live instance are reported as `skipped` rather than silently let through. Measured 2026-10-09: 83 files / 163 class declarations /
**135 call pairs** / 42 live classes / 0 resolution failures, all 9 skipped groups on the prefs side (the settings window is a separate process, so
they are never instantiated in the shell). Object traversal enters only classes declared in this repo: without that restriction it dies on
`Unsupported type GdaShort, deriving from fundamental gint` — reading a GI boxed object's property makes
GJS try to marshal a GValue it cannot represent. The probe includes a deliberate poisoning (the same resolver must let `addEntry` through and
must catch a nonexistent method name), or "0 failures" might just mean nothing was checked.

### L0b settings window (**no logout needed, and does not touch dconf**)

`lib/preferences/**` runs in a separate gjs process, so it is the only surface that can be "verified immediately after a change".
`test/prefs/run.sh` builds the whole Adw widget tree for real under Xvfb, then asserts four copy invariants against **the real controls it built itself**
(plus the `windowBuilt` precondition, so the report is `# 5/5`):

```sh
./test/prefs/run.sh                    # the criterion is on the last line: green / RED / NOT VERIFIED
COPYOUS_PREFS_DUMP=1 ./test/prefs/run.sh | awk -F'\t' '$1=="ROW"'   # list every control line by line
COPYOUS_PREFS_ROOT=/tmp/lab/copyous@local ./test/prefs/run.sh        # run a repo copy (for poisoning)
```

Four: every group has a title, **every row that changes a setting has a subtitle**, **every icon-only button has a tooltip**, and no two rows in the same
list share a title+subtitle. 2026-10-09's first run was red: 6 groups without a title,
**24/83 settings rows without a subtitle**, **28/38 icon-only buttons without a tooltip**, two rows on the Theme page sharing a title and subtitle.

After the run there is also a **user-data tripwire**: only dconf is isolated here, via `GSETTINGS_BACKEND=memory`; the data directory uses the
real path, so `run.sh` takes a fingerprint before and after — `~/.config/copyous@local` compared with `ls -l | cksum`
(neither content nor metadata may change), and `~/.local/share/copyous@local` **compared only by filename set** (daily use rewrites
`clipboard.db-wal`, so comparing size or mtime would report the user's own clipboard as "the test corrupted data"). The tripwire itself was proven to fire
with a `HOME=/tmp/…` copy, not inferred from "it did not fire".

**Coverage of restore entries is not checked here, it is checked by the static gate in this file's L0 section**: `bind` and `makeResettable` are two places in the same file's
source, and at runtime you can see the button but not which key it governs. Measured after the 2026-10-09 fill-in: all 79 controls have a restore button,
and icon-only buttons went 40 → 74 (`edit-undo` accounts for the vast majority, all with the same tooltip).

Two lessons from that round:

- **For a key bound on a subpage, the restore button hangs on the row that opens it**. The bind targets of `file-preview-types` /
  `file-preview-exclusion-patterns` / `link-preview-exclusion-patterns` / `wmclass-exclusions`
  are `Adw.NavigationPage` or `Adw.PreferencesGroup`, which **have no `add_suffix`** — attaching
  `makeResettable` to them makes the whole settings window fail to build. Poisoning proved `windowBuilt` catches this:
  `FAIL windowBuilt = row.add_suffix is not a function` + a stack to `fileItemCustomization.js:214`.
- **A button at its default value is "greyed but visible", not hidden**. Hiding it looks nicer, but then the memory backend (the whole window at default values) would
  count no buttons at all, and the runtime gate would degenerate into a no-op; a visible grey button is also the hint that "this can be restored".

Three boundaries, do not treat them as covered:


- **Only the four main pages are covered**. Subpages pushed by `window.push_subpage()` (Default Actions / Manage
  Highlight.js / the sound picker) and the controls in dialogs **are not walked** — they are not in the window tree until opened.
  Measured criterion: `ourPages=4`.
- **`Adw.Row` is not in the typelib**, and `instanceof Adw.Row` throws on the spot. The public base is
  `Adw.PreferencesRow`; `Adw.Range` likewise does not exist.
- **The icon-only-button test must exclude the toolkit's own drawings**: `AdwSpinRow`'s +/- and dropdown arrow are not our controls, and
  writing tooltips for them is labelling GTK on its behalf. After excluding them, 60 → 37, and the rest are ours (the 26 `edit-undo` ones
  all come from one `makeResettable` site, so one tooltip line fixes 26 gaps).

The instrument itself went red once, worth recording: `Gio.Application` has **no** `exit(code)` (only the private `g_application_exit`),
and `activate` returns synchronously — without `app.hold()`, a script that throws midway still exits 0, and `run.sh` prints
"green". The three locks now: `hold/release` + `System.exit(code)` + **`run.sh` judging NOT VERIFIED when it cannot find
the `# N/M checks passed` line**, never inferring "green" from "not red".

### L1 headless three arms

```sh
./test/headless/run.sh all                  # three configs × thirteen probes = 39 independent shell sessions
./test/headless/run.sh live                 # run only the current real-config arm
./test/headless/run.sh unwindowed 01 03     # run only two probes
```

The three arms are:

| config | What it covers | Why it must stay |
| --- | --- | --- |
| `live` | vertical + fixed 170px rows → **windowing active** | this is what actually runs on your machine |
| `unwindowed` | vertical + dynamic row height → **windowing off**, every entry has an actor | it is one setting away from `live`, so it must be equally green |
| `horizontal` | horizontal + fixed width → windowing active | the default arm of a fresh install |

Each probe gets its own shell session. Do **not** pack them into one session to save time: the previous probe's open/close, search, and
destroy leak into the next probe's timings and memory — a 6× fill improvement was once read as "no change" that way.

Results land in `$COPYOUS_WORK/out` (default `/tmp/copyous-harness/out`), not in the repo, so there are no artifacts needing
gitignore; if it crashes the artifacts are still in `/tmp` and inspectable.

A probe timeout is **not just one missing result**. The timed-out session is reaped by means other than SIGTERM, and it keeps holding mutter's
wayland lock (`/run/user/1000/wayland-copyous-harness.lock`) — every later session dies at startup on
`Failed to create_socket`, yet reports back `shell never answered Eval`. In the 2026-10-10 round's
39 sessions, one `06-ux-hidden` timeout on the horizontal arm bought **7 false reds**, with nothing in the logs to show they were related.
Both places now fix this amplification: `down.sh` re-checks after sending TERM, and if anything survives, escalates to KILL and re-checks once more (the bus
socket deletion is placed after the confirmation — deleting first removes that shell's own socket too, making it un-findable); `run.sh` no longer swallows
`down.sh`'s output, and on teardown failure **stops the whole round on the spot**, because continuing only mass-produces reds unrelated to the product. The escalation has
positive and negative controls: running the old script against a fake shell with `trap '' TERM` → `WARN … survived SIGTERM` and the process still alive
(exit 1); running the new script → `escalating to SIGKILL` + `no … processes left` (exit 0).

The timeout branch also leaves **a scene** (D-055): `$OUT/<config>-<name>.stall.txt`, containing `ps -o stat,time,wchan,rss`,
`/proc/PID/wchan`, **two `majflt` samples 2 seconds apart**, a thread-name histogram, per-thread state/wchan, the rc of a
`timeout 5 gdbus … Eval '1+1'`, `MemAvailable/SwapTotal/SwapFree`, and the last 8 lines of that log.
The two majflt lines are the decider: **frozen = blocked (a deadlock of some kind), soaring = a page-fault storm**, whose handling is entirely opposite, and this machine can be either.
The poll ceiling is `CO_PROBE_POLL` (unit 5 seconds, default 90 ticks = 450 seconds); with it, this instrument can self-verify in seconds:
a temp probe `GLib.usleep(60 * 1000000)` + `CO_PROBE_POLL=2` → the snapshot's `wchan=hrtimer_nanosleep`,
`eval rc=124`, `majflt 2 → 2`. The hang itself is intermittent (see [open-items.md](open-items.md)); do not treat one red as a conclusion.

**Probe 06's phase ceilings** (D-057): `co.phase(name, budgetMs, fn)` in `_preamble.js` splits 06 into
`open / scroll / blink / ease / thumb / pin / empty / close`, each with a criterion `phase:<name>`, and there are **two legs** to going red,
because the two failure modes are invisible to each other — **never settling** is caught by the deadline (`outcome=deadline`); a **synchronous overrun** is caught by the measured milliseconds
(`outcome=done` but `ms > budgetMs`), in which case the deadline cannot fire because the main thread is still inside C.
The scroll loop also gains `STEP_CAP=400` (measured on the 255-row fixture at about 82 steps per trip `live` / about 49 steps `horizontal`, with 400 far above both)
and the criterion `scrollLoopNeverCapped`.
`verdict.js` prints one extra line `phases: name=time/budget ms`, and the red one carries its own observed value.
The budgets are set at several times the phase durations of a passing run: **red only means "go look at that section"**, not a performance regression; nor does it remove the hang itself —
the path truly blocked in C is taken over by the stall snapshot above. The temp probes used to force red (a `usleep 2s` inside a 500ms budget,
and a never-resolving promise inside a 1500ms budget) reported back
`phase:overrun = {"outcome":"done","ms":2001,"budgetMs":500}` and
`phase:never = {"outcome":"deadline","ms":1501,"budgetMs":1500}`, the whole thing `FAIL 1/3 checks`, exit 1,
with the 450-second poll never used. When changing 06, **every existing assertion is still there**: the `chk/rec/metric` key sets were `diff`ed,
none of the old 16 lost, only `scrollLoopParams` (metric) and `scrollLoopNeverCapped` (chk) added.

**A hang still leaves a section name behind**: `co.phase` first `print()`s a `[copyous-probe] phase <name> start budget=<M>ms` line before starting,
so the snapshot gains a `probe phases reached:` section (fishing all the markers out then `tail -12`). This is not decoration — on the path blocked
in C, neither the deadline nor the result file can appear, and this log line is the only thing that can still say "which section was running". And it must be a separate `grep`:
the temp probe used for the teeth (deleted after the run, transcript `docs/reports/phase-marker-teeth.txt`) prints 200 warning lines inside a 30-second-budget phase then
`GLib.usleep(120 * 1000000)`, `CO_PROBE_POLL=2` → `TIMEOUT after 10s`, and the snapshot writes
`wchan=hrtimer_nanosleep` (blocked in C) and `probe phases reached: phase marker-proof start budget=30000ms`,
while the same snapshot's `log tail:` holds only the noise lines 192–197 — **the marker was long drowned**; looking only at the log tail is as good as not looking.

After the ceilings, `run.sh all 06` was run **twice** back to back, with the readings and that hang snapshot stored in `docs/reports/06-phasebudget-three-arms.txt`:

- **The 12:06 round**: `live` **15/15** (`open=4934`, `scroll=16024`, `blink=2841`, `ease=1216`, `thumb=1316`,
  `pin=1060`, `empty=1031`, budgets in order 30000ms/60000ms/20000ms/15000ms×4; `per=182 rowsPerViewport=3 max=45110`),
  `unwindowed` **5/5** (`open=6736`, `scroll=10234`, `close=604`), `horizontal` **hung once more** (the 450s poll fully used).
  This round only the stall snapshot was kept as-is (the harness's result files are at fixed paths and were overwritten by the next round), so those millisecond values are **read at the time and transcribed afterward**;
  the snapshot itself reads `futex_do_wait`, `majflt 9 → 9` unchanged ⇒ **not paging**, `SwapFree 14472896 kB`, the thread table showing
  `wavparse0:sink` and `typefind:sink`, `eval rc=124`. **The phase ceilings are useless against this one**: when the main thread is blocked in C, neither the deadline nor the
  result file can appear, and what catches it is still D-055's snapshot.
- **The 12:32 round**: all three arms **green** — `live` **15/15** (`open=4285`, `scroll=16860`, `blink=2937`, `ease=1208`,
  `thumb=1303`, `pin=1057`, `empty=1033`), `unwindowed` **5/5** (`open=7056`, `scroll=12960`, `close=603`),
  `horizontal` **15/15** (`open=4427`, `scroll=12439`, `blink=4272`, `ease=1236`, `thumb=1502`, `pin=1059`,
  `empty=1031`, `per=262 rowsPerViewport=5 max=64237`), zero of each of the five print shapes.
  ⇒ The ceilings did not turn the intermittent hang into a permanent red; `horizontal` went green on the same thing a third time, again proving it is not reproducible on demand.

Following that snapshot, a targeted experiment was run (a temp probe replicating `tryCreateMediaFileInfo`'s sequence, deleted after the run, transcript
`docs/reports/media-race-concurrency.txt`): **two pipelines in flight at once, each with that 50ms poll, both settled in 53ms**
(`PASS 2/2`, criterion `bothPollsSettle`); without polling it returns in 12ms, and is `ok=false`, `dur=-1` to begin with
— an immediate query gets no duration, so that poll loop in the product code is not an optional decoration. ⇒ The "concurrency locks the main thread" shape is **disproven**;
the hang needs 06's fuller context to appear. Do not write these two as the same conclusion.

One instrument pitfall when writing this kind of targeted experiment: in `Eval`, `await import('gi://Gst')` **without enabling first** leaves
that promise never settling (the probe printed not one marker, and the main loop idled in `poll_schedule_timeout`),
while `imports.gi.Gst` works normally. The dynamic import in the product code works because it is in a module context — a different matter.

**Body-text sentinel** (D-058, the last part of `run.sh`): the five print shapes count word classes, and **none reads content**, while the two
journal leaks this repo fixed land in the log as a line of ordinary body text. Running it is just the usual `test/headless/run.sh all`; the green path gains one line
`fixture body text in session logs: 0 line(s) across N session(s)`. Three points, all of which a lazy implementation would miss:

1. The phrase table is **extracted from `make-fixture.js` itself** (`test/headless/fixture-phrases.mjs`: two pools, `CJK` / `LATIN`,
   plus three structural markers, 14 in all), not a list copied into the script — a copied list drifts from the fixture on its own, and the direction of drift is "always green".
   Failing to extract a pool, a literal, or fewer than 8 entries all exit 3, and `run.sh` records "could not extract the table" as FAIL.
2. A hit reports only **file, line number, which phrase matched** (`grep -a -H -n -o -F`), and **does not print the line**. `-H` is deliberate:
   with only one log, grep omits the filename by default and the report becomes `23:会议纪要…`, with no way to tell which session leaked.
   What is reported can only ever be a **fixture phrase from the list** (the sentinel can only match those), so this gate itself cannot become the leak it checks.
   Teeth scene: `/tmp/copyous-harness/out/live-99-leak.shell.log:16:会议纪要：本地生活服务平台改版`.
3. Each run clears `$OUT/*.shell.log` first. In the past "across all sessions" was really "across every session this directory has ever held" — this round counted
   **50** historical logs mixed into the criteria, so a diagnostic probe deleted last week could leave a red alive today.

Teeth (all on a real nested shell): a temp probe (prefix `99-`, deleted after the run, so no filename here) deliberately prints one line of fixture body →
the probe itself `PASS 1/1`,
while the gate reports `1 line(s) across 1 session(s)` and `RESULT: FAIL` (full text `docs/reports/sentinel-teeth.txt`);
after deleting it, the next run reports `0 line(s) across 1 session(s)` and PASS — the two together prove the red came from the sentinel and does not stick to history.
The extractor's three failure modes were each produced once (pool renamed / body wording changed / code marker changed), all three `exit=3` with a named reason,
and after each run everything was restored byte for byte asserting `git status --porcelain test/headless/make-fixture.js` is empty.

**What it governs must be stated plainly**: the sentinel measures fixture body text in **nested-shell session logs**, the L1 layer. The real session (L2) has no
"known body text" to use as a list — that is the user's real clipboard, so the L2 side still relies on shape counting plus the two rules "this repo does not print body text"
(`clipboardDialog` / `actionMenu`'s fixes themselves), not this gate's coverage.

**The bisection knob** (D-059): `CO_SKIP_PHASES=scroll,blink test/headless/run.sh live 06` cuts the named phases out entirely,
recorded in the phase table as `scroll=0/60000ms(skipped)`. The guard `everyRequestedSkipRan` in `done()` compares "what was requested to skip" against
"what really was skipped", failing on a misspelled name — without it, a misspelled phase name buys a green that bisected nothing.
One usage pitfall I just hit myself: `run.sh`'s probe argument is a **prefix** (it matches filenames as `<arg>-<name>.js`), so
a temp probe must be passed `99`, not `99-walk`; passing it wrong makes it exit on the spot with `no such probe` and start no session at all,
so I let a batch of 6 runs all no-op within 10 seconds (nonzero exit, so it was not misread as green — but "it ran" was almost taken as a conclusion).
The scroll loop also prints one line `[copyous-probe] scroll pass=P step=S` per step: **it must print before taking the step**, since a hang happens in the middle of a step and
a post-hoc print would never appear.

**How far the hang has been attributed** (D-059, batch 1):

After the phase markers + `CO_SKIP_PHASES` were installed, the first batch of twelve runs (`/tmp/bisect-06.log`, 13:12–13:25):

| Run | Config | scroll | Result |
| --- | --- | --- | --- |
| 1–5 | `live` | in | 5 runs all green (`scroll` 15.9–16.9 seconds, the 60000ms budget not fully used) |
| 6–10 | `live` | skipped | 5 runs all green, the phase table reading `scroll=0/60000ms(skipped)` |
| 11 | `horizontal` | in | green |
| 12 | `horizontal` | in | **hung**, snapshot `docs/reports/bisect-stall-run12-horizontal.txt` |

Run 12's marker section is `scroll pass=0 step=38…49`, and this horizontal geometry's
(`per=262`, `rowsPerViewport=5`, `max=64237`) loop upper bound is exactly `i=49`: `49×1310=64190 ≤ 64237 < 50×1310`.
**That is, the step of "scrolling the list to the very bottom"**. Adding the 13:05 `live` arm (its markers only the two lines `open` + `scroll`,
`docs/reports/stall-live-06-named-scroll.txt`), two of seven samples carried a name, both in `scroll`.

**These two together still do not constitute a verdict**, stated plainly so nobody uses it as a conclusion next time: the incidence in this batch is roughly 1/6–1/7,
and "5 runs with scroll skipped all green" has about a 0.45 probability of happening at p≈0.15, and about 0.73 at p≈0.25 ⇒ **indistinguishable** from "scroll is not necessary".
The next thing to separate is **the two halves of the same step** — whether it is the `adj().value=` re-layout, or the `sleep` after it failing to return;
the probe now prints two markers per step (`step=i` and `step=i assigned value=…ms`), and batch 2 has now measured it (below).

**The boundary is decided** (batch 2, 30 runs, 2026-10-10; recipe `/tmp/bisect-06b.sh` + resume `-06c.sh`, data `docs/reports/batch2-result.txt`):

`06` ran 30 times — 22 horizontal (5 with `CO_SKIP_PHASES=scroll`) and 8 live (2 skipping scroll):

| Arm | Runs | Stalled |
| --- | --- | --- |
| horizontal, scroll included | 17 | 12 (71%) |
| horizontal, scroll skipped | 5 | 0 |
| live, scroll included | 6 | 1 (17%) |
| live, scroll skipped | 2 | 0 |

Pooled: scroll **included 13/23** vs **skipped 0/7** (Fisher exact two-sided p = 0.0104; horizontal alone 12/17 vs 0/5, p = 0.0096; the live arm alone has too few runs). Because the probe prints `step=i` *before* `adj().value=` and `step=i assigned value=…ms` *after* it (D-059 ②), **every stall — 13/13 here plus the 6 of batch 1's 450s-timeout runs (19 total) — stops at the bare `step=i` and never reaches the `assigned value` line**. So the boundary batch 1 left open is closed: **the freeze is inside the `adj().value=` re-layout, never the `sleep` after it.** It always lands on the loop's **final** step (the "scroll to the very bottom"; horizontal i=49, one sample at pass=1; live i=81), and it **requires the `scroll` phase** — removing it gave 0 stalls in 7 runs.

Probe list:

| Probe | What it judges |
| --- | --- |
| `01-search-equivalence` | whether entry-layer filtering and the **deleted** per-type `search()` overrides are equivalent item by item (the reference implementation is copied into the file). Compares all of `_entries`, not actors |
| `02-lifecycle-modal` | `modalActorFocusStack` zeroed after open/close/reopen mid-animation/rapid toggling; index navigation; the no-match placeholder |
| `03-container-invariants` | `_entries` ordered, the actor mirroring the correct slice of `_filtered`, Home/End/Tab, content-change focus handover, live copy, deletion, re-sorting on a timestamp change |
| `04-windowed-structure` | windowed extent A/B, scroll alignment, focus leaving and returning to the window, search windowing, deletion/re-sorting |
| `05-windowed-cost` | resident-set ceiling, RSS, scrolling cost — **reported only, not gated** (see [reading-the-log.md](reading-the-log.md) and [cost-measurement.md](cost-measurement.md)) |
| `06-ux-hidden` | the things 01-05 do not look at but a human feels: row-build cost broken down by type, whether scrolling triggers a DB write, whether animation focus builds and destroys repeatedly, whether a selected item is destroyed while still visible, whether the scrollbar thumb size is stable, the interaction of pin with `exclude-pinned`, the empty-history state |
| `07-wiring` | whether call sites match the receiver's class: derives `this._x = new Cls(` + `this._x.m(` from the source and resolves `m` on the **live object** (replacing the old name-table grep that permanently false-alarmed). Categories with no live instance are recorded as skipped and printed, and it includes a self-poisoning proving it is not a no-op |
| `08-permissions` | the permissions of on-disk content: **before** enable, create by hand the "residue left by an old version" (`images/`, `languages/`, `backup/sub/`, cache, config each with a file, all poisoned to 0775/0644, plus a symlink to an out-of-tree 0644 file), then after enable assert all three roots are 0700/0600 and that out-of-tree file **was not** changed through the link |
| `09-cache-residue` | whether the search memo table (inner key being **the entire untruncated clipboard content**) is held by the instance: take the class from a live object and `new` a SearchEntry, which must be an **empty table and not the same Map**; then `disable()` must release `clipboardDialog`. RSS is reported only, not gated (GJS has no deterministic collection point) |
| `10-notification-loopgap` | how long the main thread is pinned when copying an image: `send-notification` is turned on by the probe itself (default false, no arm covers this branch), and the 1728x1056 image in the fixture is written as a real file by `make-fixture.js`. **The ratio is reported only, not gated** (measured 1.3–1.57 fluctuation vs 2.1 in the old code); the decidable gate is the deterministic one: a URI path containing escapes must still resolve a preview and a size — the old code stripped `file://` and handed it to GdkPixbuf as a path, so an image path containing a space failed to decode outright |
| `11-grab-failure` | whether the dialog's state is cleaned up after a rejected modal grab: `_updateCursor` must return to true (otherwise `show-at-pointer` is dead for the whole session), the modal stack must zero, and it must open again normally after a rejection. **The injection point can only be `global.stage.grab`** — `Main.pushModal` is a named export of `ui/main.js`, and a module namespace is read-only, unchangeable; and the real route of "hold SYSTEM_MODAL then open" measured as **not rejected** (the later request takes the grab, and the earlier one actually gets `is_revoked()=true`), so both approaches are run, with the real one only `rec`ed, not `chk`ed |
| `12-actions-config` | whether an `actions.json` that parses but has no `actions` kills the entry menu, the action shortcuts, and the whole Actions page together. Four legs: **first write its own sentinel** (a file with a single valid action) and wait for the menu to report that id → swap in `{}` and wait for the menu to **leave the sentinel** → swap the sentinel back (proving the guard is not "always return defaults") → restore the original file and wait for the menu to agree. A copy with the guard removed **FAIL 6/8** (`not-an-array:undefined` + 2 unhandled rejections + 1 disposed attributed to copyous), the fixed one **PASS 8/8** |
| `13-media-duration` | the one thing `gi://Gst` serves: the duration badge on an audio File entry. `make-fixture.js` writes a real 8kHz/16bit WAV (**name with a space**, so what is stored is a percent-encoded URI), and the expected duration is **computed from the file's own RIFF header** (`dataSize / (rate * blockAlign)`), not copied from a constant in the code — changing the length needs no probe change. Under windowing the entry must first enter the viewport, so filter by type down to 5 File rows. The ten legs include a **negative leg**: another non-audio File row must not grow a duration control (otherwise "cutting too many cases" would also go green). 2026-10-10 live: `live 13` = **10/10**; making the expectation deliberately +1 second → **FAIL 9/10** printing the real labels `["48","48","KB","KB","3s","3s"]`, teeth verified |

### L2 real session (read-only)

See [reading-the-log.md](reading-the-log.md) for getting the PID + [reading-the-log.md](reading-the-log.md) for interpreting it.

## 3. The boundaries of the isolated headless shell

`test/headless/up.sh` relies on six things to avoid polluting the real environment; none of them may be broken when editing this script:

1. **A private dbus-daemon** (`$WORK/bus`), not the user session bus.
2. **`GSETTINGS_BACKEND=memory`** — reads schema defaults, discards all writes, and touches not one byte of real dconf.
   It is **per-process**, so settings can only be written inside Eval; `gsettings set` in an outer shell has no effect on it.
3. **`XDG_DATA_HOME=$WORK/xdg`**: the extension body is a **symlink** (so on-disk edits get loaded), while
   app-data (`highlight.min.js`, `languages/`) is **copied with `cp -a`**. Symlinking app-data would make the second
   shell write into the real `~/.local/share/copyous@local`.
4. **`XDG_CACHE_HOME=$WORK/xdg-cache`** (an empty directory, cache being regenerable) and
   **`XDG_CONFIG_HOME=$WORK/xdg-config`** (symlinking the real `~/.config/*` one by one, except that
   `copyous@local` is a **real directory** + a `cp -a`'d `actions.json`). These two were forced by `makeStoredPrivate()`:
   it chmods these three roots on every enable, so without isolation "running a probe once" would casually change the permissions of the user's real directories.
   The config uses a symlink farm rather than a fresh empty directory so that the second shell sees the rest of the config as the real session does.
   ⚠ `copyous@local` must be skipped before creating the real directory — symlinking it first makes `mkdir -p` a no-op on the link, and
   the `cp -a` below then writes straight into `~/.config` (hit in practice, reporting "are the same file").
5. **`DEBUG_COPYOUS_DBPATH=$WORK/session.db`** — one fixture copy per session, and the real
   `clipboard.db` is never opened. Pointing it directly at `fixture.db` would let the probes' deletion/timestamp changes wear down the seed row count
   (255→250), so re-runs would no longer be idempotent.
6. The session library's parent directory (`$WORK`) is tightened to 0700 at startup by `gda.js`: owner permissions are unaffected,
   but do not expect it to be 0775.

The fixture is generated by `make-fixture.js` and is isomorphic to the real library (255 rows / 5 pinned / a 6-type distribution),
because several assertions do arithmetic on the row count (under windowing the scroll range must be exactly `n*itemExtent + (n-1)*spacing`).
If the scale changes, the assertions must change with it.

**Three hard rules for probes** (all hit in practice):

- Never `import` an extension module via a `file://` URI. That loads a second module graph and re-registers GTypes, and the extension fails to start with
  `Type name Gjs_common_gjs_JsObjectWrapper is already registered`. Take classes from live objects
  (see `Object.getPrototypeOf(...searchQuery).constructor` in `_preamble.js`).
- Never read a property of a destroyed actor, `get_parent()` included. GJS prints a CRITICAL warning, not a JS exception,
  so `try/catch` cannot stop it, and it makes a clean run look broken.
- **Do not enable a second time within the same session.** The harness bypasses the extension manager with `_callExtensionInit` +
  `_callExtensionEnable` directly, and the manager's state never becomes ENABLED, so `disableExtension()` is a no-op and
  a second enable collides with `Extension point conflict: there is already a status indicator for role
  copyous@local`, after which the fill gets 0 entries (2026-10-09's probe 09 first version went red exactly this way — **what was red was the probe, not the product**).
  To prove "something is instance-held, not module-held", use **taking the class from a live object and `new`ing an instance** and comparing identity (what probe 09 does now).
- **A poisoning that takes effect asynchronously must wait for "leaving the sentinel I wrote", not for "becoming the expected value".** Probe 12's first version, after writing `{}`,
  asked "is actions still an array", and the old code still answered yes — because the change had not landed and it was reading the **previous good config**, so it tested the
  guard-removed copy as 7/7 green. Now every leg waits, anchored on "the identifiable value I wrote in first", for it to change, and times out red if it does not.
  **Green must be waited for, not slept for.**

## 10. What headless can and cannot prove

**Can**: semantic equivalence (01), structural and lifecycle invariants (02/03), extent exactness and windowing behaviour (04),
resident-set size and relative cost (05), the presence or absence of CRITICAL / JS ERROR.

**Cannot**:

- It uses the memory settings backend, which is **not** your real dconf. Config differences are modelled explicitly via `configs/*.json`,
  not via "should be about the same".
- The virtual monitor is 1280x800, with `page_size` measured at 378px; the real session is 535px. So conclusions like **window size and entries per screen
  must state which arm they come from**; cross-arm comparison is meaningless.
- It cannot measure swap pressure. The "898MB swapped out → major-fault storm" this machine first diagnosed is specific to a real session;
  headless can only prove "it no longer allocates that much", not "therefore it does not stutter". The latter needs the live numbers in [baseline.md](baseline.md).
- The fixture is synthetic. File entries point at paths that **do not exist** — which is actually a good thing: it is exactly what exposed
  the race where `FileItem.configureFilePreview()` does not check cancellation after an await and keeps writing a disposed `St.Label` after the entry is destroyed
  (windowing turning destroy from "occasional" into "continuous during scrolling").
