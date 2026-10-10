# How to read the journal, and which fields can serve as regression criteria

One thread runs through it: **get the real session shell's PID first, then filter by `_PID=`**. This file lays out the five print shapes, the attribution rules, and which numbers look like conclusions but are noise. How cost is read and its conventions are in [cost-measurement.md](cost-measurement.md).

> **Origin**: sections 4 and 5, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split) (the RSS and scrolling-cost entries moved into cost-measurement.md). The move was a verbatim copy;
> only the relative links were rewritten for the new directory level. This file is the sole owner of these facts; do not restate them elsewhere.


## 4. How to read the log

Get the **real session**'s shell PID first — this step has a pit:

```sh
# Wrong: catches the headless shell left behind by test/headless; every memory number is its own
pgrep -x gnome-shell

# Right: the real session shell carries --mode
pgrep -af "gnome-shell --mode"
# or exclude explicitly
pgrep -x gnome-shell -a | grep -v -- --headless
```

Criterion: a command line containing `--headless --wayland-display=wayland-copyous-harness` is a test process, not your session.

**`logger.error` renders as `GNOME Shell-CRITICAL`**; `logger.warn` does not. So a "recoverable environment condition"
is always `warn`, and only a real break is `error` — otherwise the "CRITICAL must be 0" gate above gets permanently
reddened by one legitimate failure. Trap instance: `open()`'s rejected grab (another client holding SYSTEM_MODAL) used to go through `error`,
and when probe 11 deliberately produced that path we saw `[Copyous] [Copyous] open(): pushModal grab failed`
land as a CRITICAL; after changing it to `warn`, the same run's CRITICAL count went to zero. **By the way**: that message carried its own
`[Copyous] ` prefix while logger already adds one, so the log showed it doubled — do not write the prefix in the message body.

On 2026-10-10 the whole class was swept (`rg 'logger\.error' extension.js lib`, minus prefs), **9 sites downgraded to `warn`**:
Gda typelib missing, media-duration probing failing, file info and file preview failing to build, two image-notification decodes, link metadata and
link thumbnail two cases, stylesheet load failure, `makeStoredPrivate()` not changing permissions. The remaining `error`s meet a single
standard: **the user's library or data is genuinely damaged** (prune failure, unrecognised entry type, entry-build exception, Gda and JSON failing to start,
image-delete and DB-write failures). One slip during the sweep is worth recording here: `rg '\berror\('` cannot see `.catch(error)` —
**passing a function as a callback** — so deleting that binding broke enable() outright, caught live by the L1 gate as
`deferred enable failed: ReferenceError: error is not defined`, which L0 cannot see (`extension.js`
cannot be loaded in Node). The same sweep also turned up two calls that **wrote user content into the journal** (see AGENTS.md's
privacy item); the fix was to keep only type and id.

```sh
LOG='journalctl --no-pager -o cat'
$LOG /usr/bin/gnome-shell | grep -a '\[timing\]'          # all timings
$LOG /usr/bin/gnome-shell | grep -acE 'CRITICAL|JS ERROR'  # must be 0
```

**The third print form** (2026-10-09, learned the hard way): when a promise nobody `.catch`es is rejected, GJS prints
`Unhandled promise rejection`, neither CRITICAL nor JS ERROR — `run.sh` now counts it separately.
Trap instance: a `{}` `actions.json` made `actionMenu.js` and `shortcuts.js` each throw in their listener callbacks
twice, the entry menu and action shortcuts failing for a full 1.5 hours while every gate stayed green.
`run.sh` also has a **user-data tripwire**: before running it takes `ls -l | cksum` of `~/.config/copyous@local`,
compares after the run, and on a difference prints `USER DATA TOUCHED` and fails the whole round (`~/.local/share` is deliberately not compared: the real session
writes it while copying, so it always differs = always a false red).

**The fourth: accessing a disposed object is a warning.** It must be counted separately, and filtered by pid:

```sh
# ⚠ The line above is **not enough**: GJS prints access to a disposed object as a warning, matching neither keyword.
# Count it separately, and by pid — a logout flushes a batch from the previous shell's teardown, and those are not this repo's:
journalctl --no-pager -o cat --since="<this login time>" _PID=<pid> | grep -ac 'has been already disposed'
# Attribution looks at two places: whether a stack frame contains extensions/copyous@local/, and whether the message header names Gjs_common_gjs_<Class>
grep -E '^(Rss|Swap)' /proc/<pid>/smaps_rollup             # resident / swapped out
awk '{print $12}' /proc/<pid>/stat                          # majflt
```

**The fifth: C-side GLib assertions. Only discovered 2026-10-10; all four earlier shapes cannot see it** — a failure written by GLib
itself has **no "CRITICAL" word in the message body at all**; the domain and level live in journald's structured fields
(`PRIORITY=4`, `GLIB_DOMAIN=GLib-GObject`), so a word-counting gate counts none of them:

```sh
# three live lines from this round's real session (PID 3147, started 08:03)
journalctl -b -o cat /usr/bin/gnome-shell | grep -acE 'CRITICAL|JS ERROR'   # 1  ← the dash.js one, not this repo
journalctl -b -o cat /usr/bin/gnome-shell | grep -acE 'assertion .* failed' # 1  ← g_object_unref: G_IS_OBJECT
journalctl -b all -o cat /usr/bin/gnome-shell | grep -acE "assertion .* failed|g_return_|has been already disposed"  # 1720
```

By family (cross-boot totals): `clutter_text_set_text` / `clutter_text_get_text` / `clutter_text_get_editable`'s
`CLUTTER_IS_TEXT (self)` at 190 each (one failure writes three, so 190 events),
`meta_window_set_stack_position_no_sync` 180, `pango_layout_get_cursor_pos` 164,
`St.Label … has been already disposed` 60, `g_object_unref: G_IS_OBJECT` 27.

**Attribution conclusion: this batch is not this repo's**, on two independent pieces of evidence: this repo's shell-side code has `\.unref\(|g_object_unref`
hits of **0** (in GJS, calling unref on null throws a TypeError and cannot print a GLib assertion); and the stack frames near
`has been already disposed` group by owner as shell ui 1664 / Vitals 1590 / notification-grouper 159 / caffeine 105 /
blur-my-shell 8 / macos-dock 1, **copyous 0**. In this boot these five families had **0** lines, the most recent
`CLUTTER_IS_TEXT` being 2026-10-09 13:22:16 — in a shell before that.

Two querying pitfalls, recorded along the way: **case** — `grep 'Assertion'` counts 0, while the message body is lowercase `assertion`;
and **`grep -c` exits 1 on a zero count**, breaking the `&&` chain right there — do not read "the chain broke" as "this one was checked".

`run.sh` now gates both the fourth and fifth. Assertion lines, like disposed, split into three tiers — **total / a repo stack frame or
`Gjs_common_gjs_` within 6 lines / unattributable** — and only the middle tier goes red: C-side assertions carry no JS stack, so counting them all as our own
would false-alarm daily, and a gate that cries wolf gets turned off within a week. Attribution was verified on synthetic logs: pure foreign → `1 0`, immediately followed by a repo stack frame →
`1 1`, mixed → `2 1` (2026-10-10, `assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL`).

**A sixth gate reads content, not shape** (D-058). The five above count "how many times a word class appears", and none reads characters. The two
journal leaks this repo fixed — `clipboardDialog.js` printing the whole entry object and `actionMenu.js` printing the action's stderr — happen to belong to none of
those five: it is a line of **ordinary body text**, shape-indistinguishable from an innocent log. So `run.sh` gains a **body-text sentinel** at the end: the phrase table is
**extracted by `test/headless/fixture-phrases.mjs` from `make-fixture.js` itself** (two phrase pools, `CJK` / `LATIN`, plus the three structural markers of the generated
code bodies); failing to extract exits 3, and `run.sh` records "could not extract the table" as FAIL rather than green — an empty list would leave the sentinel
permanently green, which is worse than no sentinel. On a hit it reports only **file, line number, which phrase matched**, never printing the line itself: this gate must not become
the very leak it checks.

What it lets through is part of the design: what is matched is body phrases, not digits, so legitimate numbers like ids, durations, byte counts, `250 matching`
do not go red; the cost is one extra `grep -F` per session (fixed strings, no regex).

An instrument-scope change came with it: `$OUT/*.shell.log` used to be overwritten by same-named `(config, probe)` and **never cleaned**, so "across all sessions"
really always meant "across every session this directory has ever held" — a diagnostic probe deleted last week could leave a red alive today. Now each run clears `*.shell.log` first,
and a gate measures exactly the sessions it produced this round (`*.json` and `*.stall.txt` untouched; the former is read as the latest anyway, the latter is kept for inspection).


Field meanings:

| Log | Meaning | Note |
| --- | --- | --- |
| `loaded N entries in Xms` | The DB query itself | Pure I/O + row build |
| `filled N entries in Xms` | Registers N entries and builds actors for those in the window | **Under windowing this is the line that best reflects the gain** |
| `warmup took Xms` | Startup warm-up | Under windowing it warms only a few, not all |
| `open(): show` | From open to `show()` returning | ⚠ Cannot be a criterion on its own, see "which numbers can be regression criteria" below |
| `open(): pushModal` | Grab the modal | |
| `open(): TTI (main loop free)` | Main loop idle again | **Watch this to judge a regression** |
| `open(): idle after redraw` | Idle after redraw | ⚠ The first-open one is polluted by the progressive-reveal gap |
| `page_size Ppx, N matching, M materialized` | Viewport height / **post-filter** count / actors built | See "matching is not the total" below |
| `progressive reveal: ...` | The four-way mutually exclusive ledger `work + gap + pseudo + setup` | Under windowing this should no longer appear |

**`matching` is the post-filter count, not the row count in the library.** With `exclude-pinned=true` it is the row count minus the pinned count
(this machine: 255 rows − 5 pinned = `250 matching`). This is not a lost entry — a false alarm was once raised over it, do not re-check it.

## 5. Which numbers can be regression criteria, and which cannot

- **Can**: `TTI (main loop free)`, the `CRITICAL|JS ERROR` count, **the copyous-attributable count of `has been already disposed`**
  (`run.sh`'s three numbers at the end: total / attributable / foreign; foreign is reported, not judged),
  **the repo-proximate count of C-side GLib assertions** (the fifth shape, likewise three tiers),
  structural assertions like `residentSetStaysBounded`, and 01's equivalence-comparison and mismatch counts.
  ⚠ **The old version writing only "the CRITICAL count must be 0" is not enough**: GJS prints access to a disposed object as a **warning**,
  matching neither `CRITICAL` nor `JS ERROR`. Measured in that 2026-10-09 boot: the old criterion counted 1 (and it was dash.js's),
  while **12** disposed warnings flushed from the exiting old shell in the same period, invisible to the old criterion.
  Attribution rests on two things: `extensions/copyous@local/` appearing in a stack frame, or the message header naming `Gjs_common_gjs_<Class>`
  (every class in this repo is registered through `lib/common/gjs.js` and its GType name always carries that prefix; foreign ones look like:
  `Gjs_ui_layout_UiActor`, `Gjs_caffeine_patapon_info_extension_CaffeineToggle`).
  **On the real-session side you must filter by `_PID=`**, or the cleanup noise from the previous shell's exit is counted against this one.
- **Cannot**: `open(): show`. Measured spread of 2.65× within one boot (337–895ms, n=6), and the cold/warm relationship also flips between
  boots. No single code regression can make the cold path faster and the warm path slower at once.
- **Cannot**: the first open's `idle after redraw`. It runs at `PRIORITY_LOW(300)` while the reveal slices are
  `PRIORITY_DEFAULT_IDLE(200)`, so they necessarily drain first, making that number almost equal to gap.
