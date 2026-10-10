<p align="right"><a href="MAINTENANCE.md"><b>English</b></a> | <a href="MAINTENANCE.zh-CN.md">简体中文</a> · <a href="README.md">README</a></p>

# copyous@local maintenance handbook

This repository is the local maintenance fork of upstream [Copyous](https://github.com/boerdereinar/copyous)
frozen at 2.0.1. There is no build step; it runs directly from
`~/.local/share/gnome-shell/extensions/copyous@local`.

This file is a **router**: it answers only "which file does this question go to", plus three things
that have no other home (the thirty-second quick reference, the code-loading rule, and
environment-residue cleanup). The prose lives under `docs/maintenance/`, and each fact has exactly
one owner — this used to be 520 lines in 12 sections, three screens to scroll for one edit; now it
is split.

"What changed and why" is in the divergence list in
[README.zh-CN.md](README.zh-CN.md#-相对上游的改动201) (authoritative); the hard rules for agents are
in [AGENTS.md](AGENTS.md). The three do not overlap, to avoid drift.

---

## Question → file

One fact, one owner. The table below is the only entry point; if you cannot find your question,
write it here first, then land it in some file — otherwise the next session will create a second
copy.

| Question | File |
| --- | --- |
| What to run before a change, in what order, where the isolation boundary is, what headless can prove | [docs/maintenance/verification.md](docs/maintenance/verification.md) |
| How to read the journal, which fields can serve as regression criteria, which are noise | [docs/maintenance/reading-the-log.md](docs/maintenance/reading-the-log.md) |
| The conventions for RSS / scrolling / CPU cost (how two numbers can be compared) | [docs/maintenance/cost-measurement.md](docs/maintenance/cost-measurement.md) |
| The windowing gate and knobs, and what turns it off **silently** | [docs/maintenance/windowing.md](docs/maintenance/windowing.md) |
| Clipboard history: on-disk location, permissions, backup, growth tiers | [docs/maintenance/database.md](docs/maintenance/database.md) |
| Platform requirements, GNOME major-upgrade checklist | [docs/maintenance/compatibility-matrix.md](docs/maintenance/compatibility-matrix.md) |
| Which Shell internals are used, and which line breaks first on upgrade | [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) |
| Current baseline: a set of numbers that must not regress | [docs/maintenance/baseline.md](docs/maintenance/baseline.md) |
| Known unfixed / awaiting your call | [docs/maintenance/open-items.md](docs/maintenance/open-items.md) |
| What changed and why (entry by entry, with commit) | [CHANGELOG.md](CHANGELOG.md) |
| Deliberate divergences from upstream (authoritative list) | [README.zh-CN.md](README.zh-CN.md#-相对上游的改动201) |
| Hard rules for agents / humans | [AGENTS.md](AGENTS.md) |
| What looks wrong and must stay wrong | [INVARIANTS.md](INVARIANTS.md) (one copy in each language) |
| Session state: progress, decisions, to-dos | `docs/reports/STATE.md` — **a local file, not committed** (it quotes raw journal lines and real config values), so a clone cannot see it |

**Citation rule**: when pointing at this content elsewhere, **point at the file, not the section
number**. The "`MAINTENANCE.md` + section number" style is entirely void — it pointed at the
520-line file from before the split, and that prose now lives in the topic files. A guard for this
lives in `test/repo.test.js`: in the whole published tree (except the date-frozen records under
`docs/reports/`), **the section-number symbol may not appear again**, and every file in
`docs/maintenance/` must be linked from the table above — the scope is derived from the directory
itself, with no allowlist, so adding a topic file and forgetting to link it is itself red.

---

## 0. Thirty-second quick reference

| What I want to do | Run first |
| --- | --- |
| Changed `lib/common/{color,glob,settings}.js` or `lib/misc/actor.js` | `npm test` (seconds, no shell needed) |
| Changed `lib/preferences/**` (the settings window) | `./test/prefs/run.sh && node scripts/settings-coverage.mjs` (seconds, **no logout needed**, does not touch dconf) |
| Touched `schemas/*.xml` (added a key, changed a default, changed a range) | `node scripts/settings-reference.mjs --write` (the README key table is generated; not writing it leaves it stale) → then run the line above |
| Changed anything under `lib/ui/**` or `extension.js` | `./test/headless/run.sh live` (minutes, hogs CPU) |
| Changed anything related to scrolling / filtering / focus | `./test/headless/run.sh all` (all three arms) |
| Touched a `gi://` dependency or added a new typelib usage | `node scripts/shell-internals.mjs` (seconds; conventions in [shell-internals.md](docs/maintenance/shell-internals.md) and [compatibility-matrix.md](docs/maintenance/compatibility-matrix.md)) |
| Want to know whether the extension burns CPU while idle | `./test/headless/idle-cost.sh 45 2` (~10 minutes; the discard window before a reading is not optional, see [cost-measurement.md](docs/maintenance/cost-measurement.md)) |
| Want to confirm a performance conclusion holds in a real session | log out and back in → see [reading-the-log.md](docs/maintenance/reading-the-log.md) for getting the PID → read the journal |
| Suspect a leftover process is disturbing a measurement | `./test/headless/down.sh` |

---

## 2. Code-loading rule (the easiest one to fool yourself with)

`gnome-extensions disable && enable` does **not** re-import any `lib/*.js`. GJS caches ESModules by
`file://` URI and never invalidates them for the shell's lifetime, and there is no `--replace` on
Wayland.

So: **after editing code, without logging out, what you see in the journal is the old behaviour.**
Do not conclude from that "the change had no effect" or "the change did not take". Either log out
and back in, or use `test/headless/` (it starts a new process each time and loads the current
content on disk).

*The prohibition itself is in [AGENTS.md](AGENTS.md)'s Critical Rules (that is where the rule
lives); this section only explains why it is so, and which surface to use to avoid it.*

---

## 9. Environment-residue cleanup

`run.sh` cleans up with `trap`, but a crash or an external kill leaves behind a headless shell
taking ~230MB, and it makes [reading-the-log.md](docs/maintenance/reading-the-log.md)'s PID method
read the wrong process.

```sh
./test/headless/down.sh          # idempotent, clears by pidfile + signature string
pgrep -af "wayland-copyous-harness"   # should be empty
```
