<p align="right"><a href="INVARIANTS.md"><b>English</b></a> | <a href="INVARIANTS.zh-CN.md">简体中文</a> · <a href="README.md">README</a></p>

# Invariants — do not "fix" these back

A pointer file. It records only what looks wrong and must stay that way, and where the proof
lives. It deliberately holds no prose that has another owner: a second copy of a fact rots
while the original stays authoritative.

The authority for behaviour changes is [CHANGELOG.md](CHANGELOG.md), not this file. Read the
recorded fixes out of the record instead of copying them here:

```sh
node scripts/check-log.mjs --invariants     # every kind:fix entry, with its commit
```

## 1. Things that look wrong and must stay wrong

| Looks wrong | Why it stays | Where it is checked |
|---|---|---|
| `shell-version` declares `"48","49","50"` while only 50.1 has ever been run here | It is a deliberate safety gate: without a match the extension simply does not load, instead of half-working. Do not add a major without checking, and do not delete one to make the range honest. | [docs/maintenance/compatibility-matrix.md](docs/maintenance/compatibility-matrix.md) — the measured-combination table and the unverified-combination list |
| `version-name` still reads `2.0.1` although the fork carries its own changes | It names the upstream baseline the fork is frozen at. Renumbering is the maintainer's decision, not a cleanup. | `metadata.json`; AGENTS.md "Release / version" |
| `paste-on-copy` is a real schema key with no settings row | `migrateSettings()` folds it into `swap-copy-shortcut` and resets it, so a control would offer a preference that no longer means anything. | `node scripts/settings-coverage.mjs` — it is the *only* tolerated no-control key |
| Four key names collide across sub-schemas (`text-count-mode`, `syntax-highlighting`, `show-line-numbers`, `background-size`) | They belong to different item types. Any "restore defaults" implementation that walks one flat key→default table will silently reset the wrong schema. | `node scripts/settings-coverage.mjs`; the nested structure in `lib/common/settings.js` |
| `theme.gresource` and `resources.gresource` are committed build output with no source in the tree | There is no build step and none may be added. Visual change == introducing a toolchain; the artifacts are readable, not editable. | [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) — the two hard platform facts |
| `lib/misc/actor.js` is imported by nothing at runtime | Deleting it means also deleting its test suite and three doc references — churn with no pain evidence. It costs nothing to keep: ESM only loads what is imported. | README's deliberately-unfixed ledger; `test/actor.test.js` |
| The undo button on a settings row stays **visible and greyed** at the default value instead of hiding | Hiding it makes `test/prefs/run.sh` unable to count the buttons in a memory backend, leaving only the static gate. Two independent gates are not redundancy. | `./test/prefs/run.sh` + `node scripts/settings-coverage.mjs` |
| There is no "reset this page" or "reset everything" button | All 79 controls already have a per-row way back. A page-level button trades 20 precise undos for one irreversible bulk write — and the live profile is customised deeply. | [docs/maintenance/open-items.md](docs/maintenance/open-items.md) |
| Copying an image still pins the main thread once, ~24–46 ms | Two full decodes were already compressed into one; gdk-pixbuf inflates only at `close()`. The remaining options are "no preview" (deleting a feature) or a subprocess (new machinery). Both need a decision. | [docs/maintenance/open-items.md](docs/maintenance/open-items.md); probe 10 |
| Windowed horizontal lists compute `upper` 15 px short at each end | Caused by theme `:first-child`/`:last-child` margins landing outside the viewport. Absorbing it means hardcoding theme constants into JS or moving the pseudo-class, which opens a visible gap that crawls down on scroll. 0.01% of extent. | README's deliberately-unfixed ledger |
| `DATABASE_VERSION` is 3 in one backend and 2 in another | Two independent format versions that happen to share a name. Not a bug; do not "unify" them. | static |
| `custom-color-scheme=high-contrast` has no template | The control never offers it and the code clamps the index, so only hand-written gsettings reaches it. Recorded, deliberately unfixed. | README's deliberately-unfixed ledger |

## 2. Designs measured and rejected — do not revive them

- **Ratio-based performance gates.** The same code produced 1.3 / 1.57 / 1.72 across three
  runs. A threshold over that scatter manufactures red. See
  [docs/maintenance/cost-measurement.md](docs/maintenance/cost-measurement.md) — the table of numbers that must not be gates.
- **Incremental PNG decoding**, to spread one image across main-loop gaps: 0.5–0.9 ms per
  slice, then 62 ms in `close()`. Decoding cannot be amortised in-process.
- **"Viewport-aware" progressive reveal**: a few tens of ms of background CPU in exchange for
  touching three counting paths at once, with "blank area after scrolling down" as the failure
  mode. Superseded — windowing makes the whole reveal path return early.
- **A `lib/shell/` facade** for the 46 private symbols. No pain evidence, and it would scatter
  calls that are coupled to animation and timing across two files. The inventory itself is the
  mitigation: [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) — the section explaining why there is no facade.
- **A "reset button on the wrong row" gate.** Twelve false alarms, because composite rows
  legitimately own several keys. It was removed; do not add it back — the key-level invariant
  in `settings-coverage.mjs` is what does the real work.
- **Module-level search memo tables.** Fixed (instance-held now), and the guard is probe 09 —
  listed here only because a future "optimisation" may reach for a module singleton again.

## 3. What may never be traded away for a metric

Priority order, as set by the maintainer: **stability > performance > appearance.** Deleting a
feature to improve a number is not an optimisation; it is a different product. Recoverable
conditions are logged with `logger.warn` — `logger.error` renders as a shell CRITICAL and
turns the health gate permanently red, which is how a legitimate one-off event becomes an
unfixable false alarm. The full rule list is in [AGENTS.md](AGENTS.md).
