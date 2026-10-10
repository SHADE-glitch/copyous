# Current baseline: a set of numbers that must not regress

The measured values of the L1 three arms and the L2 real session. It is not a report card but the **denominator for regression comparison** — after a change, compare against here; which numbers can serve as criteria is in [reading-the-log.md](reading-the-log.md). (The PLAN's split-mapping table missed this section; it was given its own file for the same reason.)

> **Origin**: section 11, moved from `MAINTENANCE.md` (520 lines / 12 sections before the split). The move was a verbatim copy;
> only the relative links were rewritten for the new directory level. This file is the sole owner of these facts; do not restate them elsewhere.


## 11. Current baseline

**Updated 2026-10-07 · six probes, three arms, 18 sessions, full run: 17 PASS + 1 correct SKIP, 0 CRITICAL / JS ERROR.**
(The previous round, 2026-10-01, was five probes and 15 sessions, the same conclusion, `39c5ea8` + the cancellation-race fix.)

### L1 headless (fixture: 255 rows / 5 pinned / 250 visible under `exclude-pinned`)

| Metric | `live` (windowed) | `unwindowed` | `horizontal` (windowed) |
| --- | ---: | ---: | ---: |
| Resident actors after fill | 3 | 255 | 3 |
| Resident peak walking the full list | 10 | 255 | 16 |
| RSS after fill | 254 MB | 319 MB | 251 MB |
| RSS after walking + returning to top | 291 MB | 379 MB | 289 MB |
| Median per-screen scroll | 20.2 ms | 1.4 ms | 28.7 ms |
| Worst per-screen scroll | 181.4 ms | 2.5 ms | 185.4 ms |
| extent tolerance | 0 px (exact) | n/a | 30 px (known, see [open-items.md](open-items.md)) |
| Probe results | 5/5 PASS | 4 PASS + 1 SKIP | 5/5 PASS |

extent A/B (force full then retract within the same session, the only variable being actor count): vertical `upper` is always **46398** =
255×170 + 254×12, identical at all seven scroll positions; RSS peaks at 377 MB at full and 359 MB after retracting the window.
**It can fall back a little, but do not use RSS as the live set** (see [cost-measurement.md](cost-measurement.md)).

Search equivalence: 6630 full comparisons + 2550 incremental comparisons per arm, **0 mismatches**.

### L2 real session (shell started 2026-10-10 11:19:34, PID 350714 — running the committed code that contains `0a0368f`)

"New code is really running" does not rely on memories like "it usually needs a restart", but on two timestamps:

```sh
ps -o pid,lstart -p 350714                                  # Sat Oct 10 11:19:34 2026
find extension.js lib -name '*.js' -newermt '2026-10-10 11:19:34' | wc -l   # 0
journalctl --no-pager -o cat --since '2026-10-10 11:19:34' _PID=350714 | grep -a '\[Copyous\]'
journalctl --no-pager -o cat --since '2026-10-10 11:19:34' _PID=350714 \
  | grep -acE 'CRITICAL|JS ERROR|Unhandled promise rejection|has been already disposed|assertion .* failed'
```

```
loaded 255 entries in 93.293ms   filled 255 entries in 127.596ms   warmup took 13.917ms
four dialog opens: TTI 160.189 (cold) / 44.510 / 33.636 / 13.522ms
          page_size 0px on a cold open, 535px after; resident actors 3 → 7; idle after redraw 707.618 / 123.951 / 104.111 / 104.199ms
five print shapes across this session: CRITICAL 0 / JS ERROR 1 / rejection 0 / disposed 0 / GLib assertion 0
          that 1 is `ui/dash.js:602 can't access property "ensure_style", firstIcon.icon is null`,
          with no repo frame in the stack (the same old error from another extension as the 2026-10-07 column)
GetExtensionErrors = empty array; GetExtensionInfo: state=1.0, error='', enabled=true, version=9.0
On-disk permissions: data directory 700, `clipboard.db`/`-wal`/`-shm`, `images/*.png` all 600,
          `find ~/.local/share/copyous@local -perm /077` no output (the 11:28 batch of writes was made by the new code)
Idle cost `./test/headless/idle-cost.sh 30 3`: three samples delta −0.010 / −0.040 / +0.070 CPU-s,
          mean 0.007 CPU-s / 30s window → VERDICT: NOT MEASURABLE (below the 1 tick = 10ms resolution,
          which is not "zero cost", only "this instrument cannot see it")
```

Compared with the 2026-10-07 column below (`loaded 371 / filled 151`) the direction is good, but **read it as direction only**: session age,
library contents, and the cold/warm relationship all flip across boots, and `open(): show` and these millisecond values are not criteria (for criteria see
[reading-the-log.md](reading-the-log.md)).

### L2 real session (logged in 2026-10-07 22:01, PID 101341)

```
loaded 255 entries in 371.126ms
filled 255 entries in 151.381ms      ← same machine, same library, before windowing: 1262 / 1390 / 1422 / 1434ms
warmup took 11.688ms
shell: Rss 359MB  Swap 24MB  majflt 60     machine-wide swap: 599MB / 15258MB
This session's CRITICAL/JS ERROR: 1, and it is another extension's firstIcon (appeared 11 times across boots),
                          unrelated to this repo; race signatures (line_wrap / already disposed) 0.
```

Against the 2026-10-01 **unwindowed** session: `filled 1262–1434ms`, `Rss 570MB`, `Swap 915MB`,
`majflt 133176`, machine-wide swap 9312MB. **The session ages differ (19 minutes vs several days), so this comparison is direction only,
not a criterion** (see [cost-measurement.md](cost-measurement.md)). The real session's `page_size` is 535px, headless is 378px, so entries per screen and
window size are not comparable across the two.

### Experience surface (probe 06, values identical across two independent runs)

> **Updated 2026-10-10**: 06 was later split into eight budgeted phases (D-057), but **what it measures did not change by a word** —
> the step arithmetic, the three full-list passes, the 40ms pause per step, and the type-timed factory wrapping are all kept as-is, and the 16 existing
> `chk/rec/metric` keys `diff`ed with none lost. So the millisecond values below are still comparable with how this page read at the time.

Windowing **moves the row-build cost from startup onto the scroll path**. This is the largest item measured this round, and the only cost the user can
feel directly:

| | Windowed (`live`) | Unwindowed (`unwindowed`) |
| --- | ---: | ---: |
| Rows built in one full scroll | ~83 steps × 2 rows per step | 0 (all built during fill) |
| Row-build time for one full scroll | **~1000 ms** | 0 ms |
| Worst single step | **182–190 ms** | 1.5–2.5 ms |

Row-build time broken down by type (each type counted independently, identical across two runs):

| Type | Builds | Mean | Worst |
| --- | ---: | ---: | ---: |
| Text | 498 | 3.0 ms | 7.1 ms |
| **Code** | 195 | **7.4 ms** | **121.6 ms** |
| Link | 9 | 4.5 ms | 9.4 ms |
| Image / File / Files | 45 | 3.3–3.6 ms | ≤ 6.0 ms |

**The Code row's mean is 2.4× Text's, with a worst single 121–133 ms (about 7 frames)**. So "it stutters when scrolling past a stretch of code history" is
real, not an illusion; unwindowed, the same cost happens during the startup fill, where nobody notices.
Mitigation directions (none done yet, pending a decision): give Code rows a larger overscan, or defer highlighting until after paint.

The other six items **are all good news, showing no hidden experience problem**:

- **Zero DB writes during scrolling** (consistent across all three arms). There was a worry that `CodeItem` lazily probing the language → `notify::metadata` →
  `updateProperty` would move the DB write onto the scroll; measured, it did not happen.
- **A selected item is never destroyed while still visible**: the window is `[first-rows, first+2·rows+1)` and the visible rows are
  `[first, first+rows]`, verified at four axes × 7 viewport positions each, 0 cases.
- **One animation focuses 0 rows built** — no repeated build-then-throw.
- **The scrollbar thumb size is perfectly constant vertically** (relative spread 0%); horizontally 0.026%, i.e. 0.006px on a 24px thumb,
  coming from the known 15px-per-end extent offset in [open-items.md](open-items.md).
- **Pinning a row does not make it vanish on the spot** (`notify::pinned` does not re-trigger filtering). But note: with `exclude-pinned=true`
  it disappears **on the next search keystroke** — this is upstream behaviour, not introduced by this branch, and the user may find it surprising.
- Empty history (a fresh install's initial state) behaves normally: shows the Empty state, 0 rows built, no orphan child nodes.
- **RSS rises with scroll passes, but windowing rises less**: over three full-list passes, windowed 290→296→314MB
  (+24MB), unwindowed 391→416→437MB (+46MB, and starting 100MB higher). So the worry "will repeated scrolling grow memory
  without bound" is backwards — the unwindowed path also rises, and rises more.


### What this verification has caught (kept as evidence that it earns its maintenance cost)

- **The `FileItem` / `LinkItem` race of writing a destroyed actor after an await**: `configureFilePreview()` did not check
  `_cancellable` after `await getFileType()` / `await tryCreateFilePreview()`, and directly called
  `insert_child_above` and `configureVisibility()`, the latter writing `this._file.clutter_text.line_wrap`
  — the label was disposed, `clutter_text` was null, so it threw `TypeError` and spewed `St.Label … has been
  already disposed`. `LinkItem`'s `await tryGetMetadata()` likewise wrote
  `this._linkPreview.metadata` bare afterward. `destroy()` had long since `cancel()`ed; nobody checked.
  **This is windowing turning a race that used to happen occasionally on clear/delete into one that happens continuously during scrolling and searching** —
  9 CRITICALs in the first round, 0 after the guard.
- Two pitfalls in the harness itself: a probe using `Math.round` while the code uses `Math.ceil` to compute viewport count, so a threshold one screen off false-alarmed;
  and `fixture.db` being used directly as the session library, with 15 sessions wearing the row count from 255 down to 250, so re-runs were no longer idempotent.
