# Known unfixed / to be confirmed

This holds only two classes: "known, but deliberately not fixed" and "awaiting your call". Anything already fixed and guarded lives in `CHANGELOG.md` and the README divergence list.

> **Origin**: section 12, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split);
> only the relative links were rewritten for the new directory level. This file is the sole owner of
> these facts; do not restate them elsewhere.


## 12. Known unfixed / to be confirmed

Not repeated here; pointers:

- Deliberate unfixed divergences and their reasons → [README.zh-CN.md](../../README.zh-CN.md#已知但有意未修的分歧点)
  (including the horizontal-list 15px-per-end extent offset, `deleteOldest`'s string surgery, `highlightAuto`'s slice length, etc.)
- **Copying an image still pins the main thread once, ~24–46ms (measured 2026-10-09)**. `NotificationManager.preview()` has already compressed two full decodes (`get_file_info` + `new_from_file_at_scale`, 46–130ms in the old code) into one, but **cannot compress it to zero**: gdk-pixbuf's PNG path inflates only at the end of the data — slicing `PixbufLoader` into 64KB chunks and yielding the main loop between them measured 0.5–0.9ms per chunk but still 62ms in `close()`; `new_from_stream_at_scale_async` only reads asynchronously, the decode is still one 32–50ms block. Below that there are only two paths left: no image preview in the notification (= deleting a feature), or decoding in a subprocess (= new machinery). Both need the user's call, so this is recorded as unfixed only. Criteria and values are in probe 10 and the comment in `lib/misc/notifications.js`.
- **No criterion guarantees that clipboard body text never appears in the journal.** D-050 fixed the two places found on the spot (`Unknown item type`
  printing the whole entry; the action's stderr landing verbatim, and its stdin is the entry body). This class of leak still **has no gate**:
  `shell-internals.mjs` only counts dependencies, the probes run only in the isolated library, and nobody looks back at log content. The shape to do it is ready-made —
  the fixture's body text is known synthetic text, and L1 can use it as a sentinel: any line of fixture entry body appearing in any session's shell log
  goes red. The cost is one extra full-text comparison per session, plus having to let legitimate numbers like ids, durations, and byte counts through. Awaiting your nod.
- **A probe timeout intermittently pins the nested shell's main thread; 7 seen this session, two of them with a section name, both in `scroll` (2026-10-10)**.
  The seven: horizontal/`06-ux-hidden` four times (09:52, 10:25, 12:06, 13:17), `live`/`06` once (13:05),
  unwindowed/`06` once (10:48), unwindowed/`07-wiring` once (10:56). Re-running the same thing immediately goes green again:
  in `run.sh all 06` the 12:32 round was **green on all three arms**, and 11 of batch 1's 12 runs were green ⇒ **intermittent, not reproducible on demand**,
  readings in `docs/reports/06-phasebudget-three-arms.txt`, `/tmp/bisect-06.log`.
  When hung, measured: main thread `state=S`, `wchan=futex_do_wait`, `utime+stime` unchanged over 6 seconds (**not busy**); `gdbus`'s `Eval` unanswered for 8 seconds;
  SIGTERM ineffective (needs D-053's KILL escalation to be reaped); the two unwindowed runs stopped after `warmup took` with **the dialog never opened** (no `open():` line),
  while the horizontal one reached open() and then went completely silent after 206 `Can't update stage views actor … needs an allocation` lines.
  **Four things ruled out**: the normal media-duration path — `13-media-duration` is green on all three arms, and the duration matches the wav's RIFF-header derivation;
  **concurrent media probing locking the main thread** — in a targeted experiment two pipelines were in flight at once, each with that 50ms poll, and **both settled in 53ms**
  (`PASS 2/2`; without polling it returns in 12ms, with `ok=false`, `dur=-1` — an immediate query never gets a duration anyway),
  transcript `docs/reports/media-race-concurrency.txt` ⇒ this shape **does not hold**; a busy loop — the CPU is frozen;
  a probe-prefix collision — that is D-054, and its signature is a nonexistent eval path.
  The latest snapshot also rules out paging: `majflt 9 → 9` / `majflt 8 → 8`, `SwapFree 14472896 kB`, while the thread table shows `wavparse0:sink` and `typefind:sink`.
  **How far attribution has come** (D-059): `co.phase` prints a marker line before starting and the snapshot gains a `probe phases reached:` section that fishes it out of the noise,
  so the 13:05 run reported `open` + `scroll` (nothing after), and the 13:17 run reported `scroll pass=0 step=38…49` —
  the horizontal `per=262 rowsPerViewport=5 max=64237` loop's upper bound is exactly i=49, i.e. **the "scroll to the very bottom" step**.
  Both named samples are in `scroll`, but **that does not mean the cause is here**: 5 runs with `scroll` skipped all went green, which at this incidence does not constitute a verdict.
  **What is still not separated**: whether what sticks in that step is the `adj().value=`-triggered re-layout, or the `sleep` after it failing to return — each step now prints two markers
  (`step=i` and `step=i assigned value=…ms`), and batch 2's 30 runs are aimed at it.
  Three more instrument-side items are done: (c) the timeout snapshot (D-055 / `3bbc8ae`), (a) phase budgets (D-057), and the
  `CO_SKIP_PHASES` knob used for bisection with its guard (D-059). Not observed in a real session (vertical + fixed row height), but 06 measures exactly scrolling,
  and horizontal is the default layout of a fresh install, so it cannot be recorded as "zero on the product surface".
- Hard rules for agents (no rebase / no changing the uuid / no introducing a build chain / commit conventions) → [AGENTS.md](../../AGENTS.md)
