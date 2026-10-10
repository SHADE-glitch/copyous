# Cost conventions: how to read idle CPU, RSS, and scrolling cost

Any conclusion of the form "how much faster / how much memory saved / does idling burn power" must land on the conventions in this file, or two numbers are not comparable.

> **Origin**: the RSS high-water-mark and "scrolling cost is a number, not a gate" entries were moved verbatim from
> section 5 of `MAINTENANCE.md` (520 lines / 12 sections before the split); the idle-CPU part was newly written on
> 2026-10-09 and **run on the spot** (the data is below, including the run that came out broken).
> This file is the sole owner of these facts; do not restate them elsewhere.

## 1. Idle CPU: it can only be diffed, and the diff is of the same process

**Why you cannot just look**: in a real session, a 30-second sample of the whole gnome-shell reads ~48% of one core, and that number is **completely unattributable** — it contains the compositor, `.index` rebuilds, other extensions, and the user's mouse activity. Treating it as "the extension's cost" is wrong; I got it wrong once.

**Method**: `test/headless/idle-cost.sh [window seconds] [rounds]` (default 30 3). It measures two silent windows inside the same headless process and subtracts:

1. `up.sh` starts an isolated shell (private dbus, memory backend, a fixture-library copy — exactly the same isolation the probes use).
2. After the shell starts, let it sit 15 s, run a **discard window**, then run the **measurement window**.
3. `ExtensionSystem._callExtensionInit/Enable` + wait for the 255-entry fill to settle, sit 20 s, again discard one window then measure one.
4. The reading is `utime+stime+cutime+cstime` from `/proc/<pid>/stat`, read at both ends of the window and subtracted.

**Why jiffies and not sampling**: those four fields are **counters**, with no sampling aliasing, no profiler overhead, and no sensitivity to swap thrash. The cost is a resolution of 1 tick = 10 ms of CPU. In a 45 s window, 1 tick = 0.022% of one core.

**Why both windows need a discard window in front of them** (the one real trap in this instrument): the first run (30 s × 3, 3 rounds) reported a **negative delta**:

```
round   off_cpu_s   on_cpu_s   delta_s
    1       0.370       0.280    -0.090
    2       0.390       0.180    -0.210
    3       0.390       0.170    -0.220
```

It is not "the extension saves CPU" but **ordering bias**: the OFF window fell at t≈15–45 s, when the shell was still doing deferred work (theming, on-demand D-Bus activation), and the ON window fell after t≈110 s, when the shell had gone completely quiet. With a discard window added, the same quantity becomes:

```
round   off_cpu_s   on_cpu_s   delta_s   delta_pct   enable_one_shot_s
    1       0.100       0.120     0.020       0.050             0.500
    2       0.060       0.050    -0.010      -0.020             0.520
mean idle delta over 2 rounds : 0.005 CPU-seconds per 45s window
instrument resolution             : one tick = 10.0 ms of CPU = 0.022% of a 45s window
VERDICT: NOT MEASURABLE -- mean is under one tick per window. Do not record this as "zero cost".
```

**Conclusion (write it down, stop re-measuring)**: this extension **does not burn power while idle** — the idle increment is below the instrument's resolution. The shell itself, after settling headless, is 0.06–0.10 CPU-s / 45 s (about 0.13–0.22% of one core), and after the extension fills 255 entries the reading shows no resolvable change.
**The boundary of this conclusion must be stated plainly**: it is about "when nothing is happening". **The cost of copy, search, and opening the dialog is measured in probes 05/10** (the milliseconds the main thread is pinned), which is the quantity that actually stutters; a CPU diff cannot see a synchronous stall of a few tens of milliseconds (the F3-measured 24–46ms kind) — it does not even fill one tick in a 45 s window. So: **"can it be felt as a stutter" uses blocked milliseconds; "does it burn power continuously" uses this diffing instrument.**

**The one number that can be measured**: `enable_one_shot` five times 0.600 / 0.520 / 0.500 (first round) + 0.500 / 0.520 (second round), a range of 0.10 s (init + enable + 255-entry fill + entry build). This is a one-off cost at login, stable and reproducible, and worth a regression line: **the day it climbs to 1.0, someone has put synchronous IO or a full traversal on the enable path**.

## 2. Memory: RSS is a high-water mark, not the live set

- **Do not use**: the absolute value of RSS. glibc does not return freed GJS memory to the OS, so RSS is a **high-water mark** and does not fall back after walking the whole list. Windowing wins on "normal use never reaches that mark", not on reclamation.

- **Scrolling cost is reported, not gated**: a median of ~18ms per screen crossed is the **cost** of windowing (destroy + rebuild about 2 items), not a regression. Writing it into a threshold turns a known good trade into a red light. A small scroll within one screen of overscan is still zero-cost.

The price of judging a real regression: a logout/login is required. Do not count on disable/enable.

## 3. How to read a leak (the instrument exists; this only fixes the conventions)

The resident set and "what is left after disable" are measured by **probe 09** (`live 09`: `entryTextsRetainedAtDisable` + the two RSS numbers before and after disable). Three conventions:

1. RSS **reports a number, it is not a criterion** — GJS has no deterministic collection point, so "did not drop" is not "leaked". The real criterion is *whether the object is still there* (live references like `_matchCache`, `_items`, `_entries`), not kernel accounting.
2. **A second enable within the same session is a harness no-go zone** (bypassing the manager makes `disableExtension()` a no-op), so "does repeated enable/disable leak" can only be checked in a real session, see [verification.md](verification.md).
3. For multi-round trends look at the **median**, not the peak: on this laptop under heavy swap, a single RSS spike can be caused entirely by paging.

## 4. What numbers cannot be criteria

| Number | Why not |
| --- | --- |
| Whole-shell CPU% | Unattributable (start of section 1) |
| A CPU diff without a discard window | Ordering bias; it reads the instrument as "the extension saves CPU" |
| Absolute RSS | A high-water mark, not the live set |
| Median scroll time | A known cost of windowing, not a regression |
| Any ratio-based threshold | The same code produced 1.3 / 1.57 / 1.72 across three runs; a threshold only manufactures red (see [reading-the-log.md](reading-the-log.md)) |
| headless `fillMs` | Measured 3.9–4.5 s (probe 04/05/06's `metrics.fillMs`, 255-entry fixture), a different scale from a real session — login fill there is a different set of numbers, so it can only be **compared within the same arm**; do not put it against the numbers in [baseline.md](baseline.md) |
