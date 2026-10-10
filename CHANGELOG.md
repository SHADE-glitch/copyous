# CHANGELOG — copyous@local

Personal maintenance fork of [Copyous](https://github.com/boerdereinar/copyous) upstream 2.0.1,
imported frozen at `335fff2`. This file records only deviations I introduced after that import.

Coverage: 335fff2..HEAD
Check with `npm run check:log`. Entries are `D-###`, monotonic, never reused.
An entry states what was true **as of its commit**, not current state: old entries are not
re-verified, and aggregate counts live in the checker's output, never in this file.

> **How these were written.** D-001..D-029 are a backfill: `Symptom` / `Change` are compressed from
> the commit subject plus the state of the touched file at HEAD, and the diffs were not re-read one
> by one. D-030 onward were written from the commit body and the diff of the same session, which is
> why their `Evidence` names real runs. Treat any entry as an index into its commit. `Evidence`
> names a test only where that suite was re-run in the session that wrote the entry; `L?` on
> purpose where it was not.

`kind` here uses six values: `fix` / `perf` / `taste` / `guard` / `revert` / `chore`. `perf` is separated
from `fix` because most of this fork's work is resource and throughput work — dropping it
re-introduces measurable degradation but not a correctness bug, and an upgrade needs to know which
is which. `chore` is the residue that owes nothing in either direction (dead code removed, a comment
corrected, a document relocated), so it must be distinguishable from `taste` at upgrade time.

The last field of a heading is the release it belongs to: `v9` is the value `metadata.json`'s
`version` held when the entry was written. It is not a verification tier -- those are the `L0` /
`L0b` / `L1` / `L2` prefixes inside `Evidence`.

---

### D-001 · 2026-09-22 · perf · v9
Symptom  Under the Gda 5 backend the poll interval was fixed, so it polled even when idle
Change   Adaptive polling
Evidence L?
Cost     Poll cadence is a trade-off between feel and idle burn; change it only after measuring
Commit   a30ac0e

### D-002 · 2026-09-22 · fix · v9
Symptom  Pruning the history did not check whether it could actually free entries, and deleted entries it should have kept
Change   Prune only when there is an entry to evict
Evidence L?
Cost     This guards user data, not performance; the regression shows up as "history mysteriously got shorter"
Commit   6ba6862

### D-003 · 2026-09-22 · perf · v9
Symptom  Default journal mode + `synchronous=FULL`: every write synced to disk
Change   Switch to WAL + `synchronous=NORMAL`
Evidence L?
Cost     **This trades durability for throughput**: on power loss or crash the last few transactions may be lost. Do not treat it as a pure optimisation when upgrading
Commit   16cbbd3

### D-004 · 2026-09-22 · fix · v9
Symptom  The `actions.json` file-watch guard judged inconsistently at its two use sites, one side protected and the other not
Change   Unify both sites on the same guard
Evidence L?
Cost     Both use sites must change in the same batch; changing one side alone is no fix at all
Commit   610e242

### D-005 · 2026-09-22 · perf · v9
Symptom  The search hot path built a new collator on every call and compared item by item
Change   memoize `localeContains`, hoist the collator call out of the loop
Evidence L?
Cost     The cache key must cover the locale, or results go stale after a locale change
Commit   040dcb7

### D-006 · 2026-09-22 · fix · v9
Symptom  Every enable/disable cycle leaked a batch of resources, growing monotonically over a long session
Change   Release the resources acquired during enable
Evidence L?
Cost     Shares a destroy chain with D-007 and D-014; read changes across the whole chain
Commit   7283fb8

### D-007 · 2026-09-22 · fix · v9
Symptom  Async init still landed its continuation after `disable()`, writing back state that no longer existed
Change   Discard async init work that outlived disable
Evidence L?
Cost     The cancellation check must carry a "which generation am I" marker; testing only `this._enabled` misses cases
Commit   ad5cb9f

### D-008 · 2026-09-22 · perf · v9
Symptom  Startup scanned a large number of paths for existence
Change   Reduce startup file probing
Evidence L?
Cost     Probing less means some errors surface later; the change must preserve diagnosability
Commit   8e158b3

### D-009 · 2026-09-22 · perf · v9
Symptom  Snippet detection ran repeatedly
Change   De-duplicate auto-detection
Evidence L?
Cost     Sits on the same startup/search hot path as D-005
Commit   51e65ba

### D-010 · 2026-09-23 · perf · v9
Symptom  Action regexes recompiled on every call; dialog open time unknown
Change   Cache the action regexes, and time dialog open
Evidence L?
Cost     The timing part is observability, the behaviour part is caching — same batch, different criteria
Commit   0c463b2

### D-011 · 2026-09-23 · fix · v9
Symptom  Common-directory derivation went wrong and returned directories it should not
Change   Fix the common-directory walk
Evidence L?
Cost     When rolling this back separately from D-010's commit, do not roll back the cache with it
Commit   0c463b2

### D-012 · 2026-09-23 · fix · v9
Symptom  Gda queries used string concatenation; entry content went straight into the statement (clipboard content is untrusted)
Change   Parameterize everything, with a correctness/performance/cleanup pass along the way
Evidence L?
Cost     **An injection surface**, not a style issue. Any later "just for convenience" string concatenation must be treated as a regression
Commit   5f1f63e

### D-013 · 2026-09-23 · fix · v9
Symptom  The modal grab stole the popup's keyboard focus; a separate `focusChild` typo kept the restore from working
Change   Restore the popup's keyboard focus and fix the typo
Evidence L0 re-ran `npm test` this round (100 pass / 0 fail; that suite covers actor visibility and focus helper primitives)
Cost     The focus path is hard to prove end to end headlessly; L2 not verified
Commit   9e32688

### D-014 · 2026-09-24 · fix · v9
Symptom  Entries were not `destroy`ed on removal, leaving a gap in the destroy chain; there was a startup race
Change   Complete the destroy chain and fix the startup race
Evidence L?
Cost     Same chain as D-006 / D-007; this is the behaviour half of that "maintenance baseline" commit
Commit   f0761fe

### D-015 · 2026-09-24 · guard · v9
Symptom  The open path had no TTI instrumentation, so "slow" could not be attributed
Change   Add TTI instrumentation to the open path (the other half of the same commit is D-014)
Evidence L?
Cost     Instrumentation changes no behaviour; it targets the "green but invisible" class of blind spot, and deleting it closes the observability surface
Commit   f0761fe

### D-016 · 2026-09-25 · guard · v9
Symptom  The progressive-reveal instrumentation mixed work and gap together; a measured first open of 6567ms was actually 95.5% idle waiting
Change   Split into two probes, work and gap
Evidence L?
Cost     Merging back into one counter reintroduces the misreading of waiting as cost
Commit   7df1fee

### D-017 · 2026-09-28 · fix · v9
Symptom  `color.js` had four defects (constructor clamping, hue normalization, named-color and hex parsing)
Change   Fix all four and add the repo's first test suite
Evidence L0 re-ran `npm test` this round: the `constructor clamping` / `hue normalization` /
         `parse: named colors` / `parse: hex` describe blocks sit within 100 cases
Cost     The tests and the fix are the same thing; reverting the fix turns the suite red immediately
Commit   4860c24

### D-018 · 2026-09-28 · fix · v9
Symptom  glob's `[!...]` negated class translated incorrectly when `]` was the first character
Change   Fix the translation and add glob unit tests
Evidence L0 re-ran `npm test` this round (glob suite)
Cost     Boundary character classes are the classic "looks fine" branch; a change here must come with a matching case
Commit   c51e620

### D-019 · 2026-09-28 · guard · v9
Symptom  `open(): show` lacked content-composition info, so when it was slow there was no telling which layer was slow
Change   Add a read-only content-composition probe
Evidence L?
Cost     A read-only probe; it must not casually become a state write
Commit   e9bc801

### D-020 · 2026-09-28 · guard · v9
Symptom  The probe was attached to an object other than `ClipboardScrollView` and always printed undefined — **the instrument itself was wrong**
Change   Add the probe method to `ClipboardScrollView`
Evidence L?
Cost     If this "missing signal, check the instrument first" fix is rolled back, every later reading is false
Commit   63b06e3

### D-021 · 2026-09-29 · guard · v9
Symptom  `Gtk` / `Gdk` imports were not version-pinned; which version resolved depended on the environment
Change   Pin `?version=4.0`
Evidence L?
Cost     Pinning makes a GNOME major change blow up at load time instead of silently taking the wrong branch
Commit   142db30

### D-022 · 2026-09-29 · guard · v9
Symptom  `link.js`'s Soup import was not version-pinned
Change   Pin `?version=3.0`
Evidence L?
Cost     Same as D-021
Commit   4ad12b7

### D-023 · 2026-09-30 · fix · v9
Symptom  An interrupted close animation skipped `popModal`, leaving `modalCount` permanently stuck; after that the modal count is untrustworthy
Change   Run popModal on the interrupt path too
Evidence L?
Cost     The residue is monotonic — one leak lasts the whole session; L2 not verified
Commit   973c840

### D-024 · 2026-09-30 · perf · v9
Symptom  Each entry built its own child GSettings; style/layout were needlessly rebuilt
Change   Share the child GSettings and skip the needless style and layout rebuilds
Evidence L?
Cost     After sharing, one write affects everyone; revisit this when changing the settings-propagation path
Commit   2eec348

### D-025 · 2026-10-01 · perf · v9
Symptom  Search-filter state hung off `actor.visible`; once the actor was recycled the filter became wrong
Change   Move filter state down to the entry layer (**no user-visible behaviour change**; a refactor paving the way for windowing)
Evidence L?
Cost     No behaviour change ⇒ no test will guard it; changes rely on reading the code to confirm the source of truth
Commit   ea06594

### D-026 · 2026-10-01 · perf · v9
Symptom  The scroll container treated the actor list as the source of truth, so entry count directly set the resident object count
Change   Make the entry list the source of truth and demote actors to a recyclable cache (no user-visible behaviour change)
Evidence L?
Cost     Same structural change set as D-025 and D-027; rolling back one alone leaves an inconsistent source of truth
Commit   6e6f8ab

### D-027 · 2026-10-01 · perf · v9
Symptom  The list built actors for every entry at once, so the resident set grew linearly with history length
Change   Build actors only for entries near the viewport, bringing the resident set down to single digits
Evidence L?
Cost     The windowing visible range is one of this repo's core sizing decisions; changing the range means re-measuring
Commit   39c5ea8

### D-028 · 2026-10-01 · fix · v9
Symptom  `FileItem` / `LinkItem` did not check cancellation after `await`, and the continuation wrote to a destroyed actor
Change   Check cancellation state before the continuation
Evidence L?
Cost     Same race class as D-007; in GJS, accessing a disposed object is a runtime error, not a silent no-op
Commit   0c277c3

### D-029 · 2026-10-01 · guard · v9
Symptom  `openProbeSummary` reported only time, not data size, so the reading could not explain itself
Change   Also report the entry total
Evidence L?
Cost     Output only, no behaviour change
Commit   a7372a4

### D-030 · 2026-10-10 · fix · v9
Symptom  On-disk permissions inherited the session umask: the app-data directory 0775, `clipboard.db` and `-wal` 0644, `images/*.png` 0664. Clipboard history is stored verbatim, and the only cover was `~/.local/share` itself being 0700 — yet the `database-location` key allows moving the directory somewhere without that layer of protection
Change   Add `FileCreateFlags.PRIVATE` to every write site and follow each write with a `GLib.chmod` (`REPLACE_DESTINATION` rebuilds the inode and knocks the mode back to the umask, and `PRIVATE` only applies on create); at the start of `enable()`, `makeStoredPrivate()` corrects residue already on disk (including `backup/`)
Evidence L1 `test/headless/probes/08-permissions.js` (creates residue by hand before enable, then asserts — not observation) new code 21/21; a `git archive HEAD` copy 3/21; a copy with `NOFOLLOW_SYMLINKS` weakened to `NONE` 20/21 (followed a symlink and changed a file outside the tree)
Cost     On this machine there is only one way to set permissions: `GLib.chmod` (`unix::set-perms` is rejected by the local backend, `gi://GioUnix` does not introspect chmod/mkdir; the reason is written in `constants.js`). Re-confirm this path still exists when changing platform or API
Commit   a93473c

### D-031 · 2026-10-10 · fix · v9
Symptom  `localeContains`'s memo table was a module-level `const` whose inner key was **the entire untruncated clipboard body**; ESM does not reload within a shell's lifetime, so the bodies of already-deleted, already-pruned entries stayed retained
Change   Have the `SearchEntry` instance hold `_matchCache`, with `SearchQuery` getting it from a constructor argument (the 8th parameter, passed through by `withChange()`)
Evidence L1 `probes/09-cache-residue` new code 6/6 (`entryTextsRetainedAtDisable=248`), HEAD copy 1/6 and the failure names "a module-level table is back". RSS reports a number only (257→254): GJS has no deterministic collection point, so "did not drop" is not "leaked"
Cost     The cache lives and dies with the instance ⇒ rebuilding `SearchEntry` loses the hot cache; moving the table back to module level turns no test red but re-retains user data
Commit   1070951

### D-032 · 2026-10-10 · chore · v9
Symptom  `SearchEntry.addItem` and `ClipBoardEntryTracker.addItem` collided in name, sending readers to the wrong place repeatedly
Change   Rename to `addFilterRow` (it adds a filter row). This class of collision used to be found with a name-table grep; that check was itself a permanent false alarm and has been replaced by `probes/07-wiring`
Evidence L0 static: the rename changes no behaviour; `npm test` 113/113 only proves nothing else broke
Cost     Owes nothing in either direction; `probes/07-wiring` is the detector for this class of collision — it derives call pairs from source and resolves them to live objects, with a self-poisoning self-test
Commit   1070951

### D-033 · 2026-10-10 · fix · v9
Symptom  `open()` set `_updateCursor` to false before show, and the only place that set it back to true was `close()`; on the grab-rejected branch `opened` was never true, so `close()` returned early ⇒ `show-at-pointer` was broken for the whole session. That same branch used `logger.error`, which renders as a shell CRITICAL — exactly the line the regression gate counts in `docs/maintenance/reading-the-log.md`
Change   Restore `_updateCursor = true` on that branch, downgrade the log to `warn` (another client holding SYSTEM_MODAL is a recoverable condition), and drop the duplicate `[Copyous]` prefix (logger already adds one; old logs showed it doubled)
Evidence L1 `probes/11-grab-failure` new code 11/11 (including "can open again normally after a rejection" and a zeroed modal stack), HEAD copy 10/11 with one extra CRITICAL in that run's log
Cost     Recoverable conditions always `logger.warn`; writing `error` back turns a legitimate event into an unfixable false alarm
Commit   85f29fe

### D-034 · 2026-10-10 · fix · v9
Symptom  The image-notification preview did `body.substring('file://'.length)` on the stored content, but what is stored is the result of `Gio.File.get_uri()` (`clipboard.js:411`), i.e. percent-encoded text — so the tail went to GdkPixbuf as a path, and only paths with no escapes at all worked. The correct shape was already right there in the same file: `tryDecodeUri(...).substring('file://'.length)` (lines 65, 247)
Change   Switch to `Gio.File.new_for_uri(body)`, the same shape as `clipboard.js:190`
Evidence L1 `probes/10-notification-loopgap`'s `escapedImagePathStillDecodes`: write a `probe 10 escaped.png` in the isolated app-data, feed its `get_uri()` (containing `%20`) to `notification()`, and assert the notification arrives with body `N×N px`; the same probe also has `bodyReportsPixelSize` / `previewIsAnImage` / `textBranchStillWorks`. This round all three arms green across 419 checks. Honest caveat: **this leg never went red this round** — written before the fix, per the "add coverage first, then fix" order, but reproducing the poison this round (reverting `notifications.js` to 68b0e1e^ in a /tmp copy) was blocked by the permission layer, so "saw it red" rests only on the previous round's record
Cost     Images in notifications are henceforth handled by URI semantics; no falling back to string slicing
Commit   68b0e1e

### D-035 · 2026-10-10 · perf · v9
Symptom  The same image paid for two full decodes: `Pixbuf.get_file_info()` and `new_from_file_at_scale()` each opened and inflated the whole PNG, both running synchronously in the clipboard `owner-changed` handler. Two real screenshots (1728×1056 / 2419×1478) measured 18–78ms plus 17–57ms, so one image copy stalled the compositor ~86–130ms
Change   Add `preview()`: one full decode yielding both the original size and the scaled preview
Evidence L1 `probes/10-notification-loopgap` measured an 86ms main-loop gap; this round re-ran three arms, 36 sessions, 419 checks
Cost     Still synchronous, deliberately: feeding `PixbufLoader` in 64KB chunks costs only 0.5–0.9ms each but 62ms in `close()` (gdk-pixbuf's PNG path inflates only at the end of the data), and `new_from_stream_at_scale_async` blocks the same 32–50ms. Below the cost of a single decode the only options left are "drop the preview" or "decode in a subprocess", recorded in `docs/maintenance/open-items.md`
Commit   68b0e1e

### D-036 · 2026-10-10 · fix · v9
Symptom  `loadConfig()` returned the `JSON.parse` result as-is, and every consumer immediately did `config.actions.map(...)`: a file that **parses but has no `actions`** (hand-written, half-saved, or left by another version) broke the entry menu, action shortcuts, and the whole Actions page at once, with the only symptom being two `Unhandled promise rejection`s — neither CRITICAL nor JS ERROR, completely invisible to the regression gate. The old code had already run `_menuActions.forEach(a => a.destroy())` before throwing, leaving a batch of destroyed but still-referenced menu items
Change   Validate `Array.isArray(parsed.actions)` at the load boundary; on failure fall back to `defaultConfig` and `logger.warn`
Evidence L1 `probes/12-actions-config` (sentinel, four legs) new code 8/8, a copy with the validation removed 6/8 (`after {} = not-an-array:undefined`)
Cost     "Parses is not the same as valid" is from here a rule for every user-editable on-disk file in this repo, not just this one. This defect was caused by my own probe: at 2026-10-09 18:02, probe 08's `{}` went through a symlink into the real `~/.config`, and the entry menu was empty for 1.5 hours
Commit   967595f

### D-037 · 2026-10-10 · fix · v9
Symptom  `disable-gda-warning` only suppressed the first failure branch (when `gi://Gda` fails to load); the second branch — `GdaDatabase.init()` throwing — popped unconditionally, so the user still got the popup after pressing Disable Warning, making the switch look ineffective. The second branch's `logger.error` also dropped the caught exception, leaving only "Failed to load Gda" in the log
Change   Have both branches read the same key and feed the same button; add the exception object to the second
Evidence L0b text side `test/prefs/run.sh` 5/5 (`lib/preferences/dependencies/dependenciesSettings.js`); L1 `probes/03` enable full chain green. **Shell-side behaviour needs a logout/login to take effect**; this entry has code-reading evidence only
Cost     The live config has `database-backend='sqlite'` and `initSqlite()` goes through exactly `gi://Gda` — this branch is not a corner path, do not treat it as secondary code
Commit   359774a

### D-038 · 2026-10-10 · fix · v9
Symptom  `contentInfo.js` statically `import Gst from 'gi://Gst'`. The failure mode of statically importing an optional typelib is not "this feature is missing" but "the extension does not load at all": gjs throws at **module-resolution time**, before the file's first statement runs (verified live with `gjs -m` — the log line after the import never printed; the same namespace via `await import()` is catchable)
Change   Move to `await import('gi://Gst')` inside `tryCreateMediaFileInfo()`; when absent, `logger.warn` and omit the media duration, the same shape as `entryTracker.js`'s Gda; behaviour unchanged when Gst is present
Evidence guard L0 `test/shell-internals.test.js` poison used the original code from `git archive HEAD`: `FAIL: gi://Gst is imported statically in lib/ui/components/contentInfo.js but the shell's own install set does not guarantee it`, exit 2. **The media-duration branch itself has no probe coverage** (no line in the fixture is a real audio/video that can yield a duration); written into the post-logout smoke checklist
Cost     Gst is not in the guaranteed set, and the set is the 37 namespaces derived from `gresource list + extract libshell-18.so`, not my guess at what counts as common; the rule that caught this original was the guaranteed-set rule, while "once dynamically imported, never statically import again" cannot catch it (Gst was only ever static, never dynamic), so both must stay in CI
Commit   6ba6ade

### D-039 · 2026-10-10 · fix · v9
Symptom  Three keys had no control in the UI at all; for `disable-hljs-dialog` the only write path was that prompt's Cancel — press it once and it never asks again, with nowhere in the settings window to change it back. On the restore side: 34 call sites covered 43 keys
Change   Add the controls and the `makeResettable` entry points, reaching 79 controls / 79 with a restore entry
Evidence L0 `node scripts/settings-coverage.mjs` `RESULT: PASS` (82 keys / 8 schema paths); L0b `test/prefs/run.sh` 5/5
Cost     `paste-on-copy` is the only key without a row, and **it is not a defect**: `migrateSettings()` folds it into `swap-copy-shortcut` and resets it. For keys whose value is bound on a subpage (`Adw.NavigationPage`, which has no `add_suffix`), the button must hang on **the row that opens that subpage**; attaching it to the page itself makes the whole settings window fail to build
Commit   978f0f8

### D-040 · 2026-10-10 · fix · v9
Symptom  The settings window went red the first time the instrument walked it: 6 groups without a title, 24/83 rows without a subtitle, 28/38 icon-only buttons without a tooltip, two rows on the Theme page sharing a title and subtitle; `edit-undo-symbolic` used one icon for two meanings
Change   Fix them one by one: give titles to Shortcuts' 3 groups and Actions' 2 groups (Popup Menu renamed Filter Menu, since that page really governs the filter menu); write a subtitle for each of the 24 rows (read the real behaviour of `searchEntry.js` / `clipboardDialog.js` / `contentInfo.js` first, then word it — not from memory); add tooltips to the view-more / dialog-warning / language-filter buttons; rename the Theme page's second row to Base Color Scheme (it actually selects which built-in scheme a custom colour falls back to); turn the Database row's button that resets nothing into a text button
Evidence L0b `test/prefs/run.sh` 5/5 (142 rows / 23 groups / 74 icon buttons)
Cost     The subtitle is the sole owner of "what this item changes" — the README key table deliberately omits that sentence. Deleting copy is deleting documentation, not decoration
Commit   978f0f8

### D-041 · 2026-10-10 · guard · v9
Symptom  `lib/preferences/**` runs in a separate gjs process, the only shell-side surface verifiable without a logout, yet nothing turned red on its account
Change   `test/prefs/run.sh` registers the shell's own `org.gnome.Shell.Extensions` gresource under Xvfb, builds a real `Adw.PreferencesWindow` with `GSETTINGS_BACKEND=memory`, walks the whole tree asserting four copy invariants (groups have titles, rows that change a value have subtitles, icon-only buttons have tooltips, no two rows in the same list share a title+subtitle), and reports `(user data untouched)` at the end
Evidence Ran for real this round, 5/5 green; the first run went red with 6/24/28 defects, fixed afterward by D-040
Cost     Three pitfalls are written at the top of the script: `GI_TYPELIB_PATH` must include `/usr/lib/gnome-shell/girepository-1.0` before the first `gi://`; `Adw.Row` is not in the typelib (the public base is `Adw.PreferencesRow`); `Gio.Application` has no `exit(code)`, so without `hold()/release()` + `System.exit` a script that throws midway still exits 0 — hence "did not print `# N/M checks passed`" is judged NOT VERIFIED rather than pass
Commit   5c2b286

### D-042 · 2026-10-10 · guard · v9
Symptom  headless had only five probes, with no gate for three classes of failure: instrumentation that cannot read the true value (probe 12's first version reported 7/7 green on code with the guard deleted), disposed warnings (the CRITICAL gate cannot count them; measured 12 vs 1), and probes writing through to user config; meanwhile `run.sh all` overwrote each arm's same-named results, leaving only the last arm on disk — yet cross-arm comparison is the whole reason the suite exists
Change   Add 07-wiring / 08-permissions / 09-cache-residue / 10-notification-loopgap / 11-grab-failure / 12-actions-config (12 probes × 3 configs = 36 sessions); prefix artifacts by config name; report disposed as two quantities (total / attributable to this extension, the latter >0 meaning FAIL); hash `~/.config/copyous@local` before and after, and fail the whole round as `USER DATA TOUCHED` if it differs; `up.sh` also redirects `XDG_CACHE_HOME` and `XDG_CONFIG_HOME`, and after building the symlink farm **asserts** those two roots are not symlinks, refusing to start if they are. `make-fixture.js` gains one real image (the original 7 were all 74-byte colour blocks)
Evidence This round `run.sh all` 36 sessions, 419 checks (live 151 / unwindowed 117 / horizontal 151); the attribution rule was verified on a constructed log of 12 real foreign + 1 repo stack frame (output `14 2`)
Cost     `~/.local/share` is deliberately not hashed: the real session writes history there, so it always differs, and comparing it would cast the test as the culprit. This line of defence is not hypothetical — see D-036's Cost
Commit   d7b4f47

### D-043 · 2026-10-10 · guard · v9
Symptom  Idle CPU could not be attributed — our share of whole-shell CPU% is invisible; a real session idles at tens of percent, none of it this extension's
Change   `test/headless/idle-cost.sh` diffs the same process: samples `/proc/<pid>/stat`'s `utime+stime+cutime+cstime` (`CLK_TCK=100`, 1 tick = 10 ms), and **puts a same-length discard window before every measurement window**, or the bare-shell reading is inflated by deferred startup work and the delta comes out negative
Evidence Two real runs this round: the biased version reported `-0.090 / -0.210 / -0.220` (the instrument claiming "the extension saves CPU"), the fixed version `+0.020 / -0.010`, mean 0.005, verdict line `NOT MEASURABLE`
Cost     This script rode along in the previous commit — `git add test/headless` swept it into `d7b4f47`, whose message does not describe it. Splitting it out would rewrite history, which this repo forbids, so the fact is recorded here. Reading resolution is 10 ms; any "idle difference" below that must not be used as a gate
Commit   d7b4f47

### D-044 · 2026-10-10 · guard · v9
Symptom  `makeResettable(row, settings, 'typoed-key')` returned the row unchanged: no button, no error, no runtime symptom — a setting with no way back looked perfectly healthy
Change   `scripts/settings-coverage.mjs` does a key-by-key static reconciliation of schema ↔ prefs, with four ways to go red: a control without a restore entry, prefs using a key the schema does not declare, a reset with no control found, and `bind` writing the key name as a variable (a shape the audit cannot see, so it rejects rather than skips)
Evidence L0 `npm test` 113/113 including `test/settings-coverage.test.js`; run directly it is `RESULT: PASS`. All four red modes were poisoned one by one
Cost     One criterion is **deliberately downgraded**: "reset button on the wrong row" would produce 12 false alarms, because composite rows legitimately own several keys (position owns 6 placement keys, playSound owns sound+volume, the exclusion row owns a whole subpage); the reason is in a comment so the next person does not add it back. Self-check: the parsed key count must equal the number of `<key` occurrences, exit 2 otherwise — added after fixing the real "missed `flags=`" bug, which had reported the actually-present `file-preview-types` as a ghost key
Commit   9b996dd

### D-045 · 2026-10-10 · guard · v9
Symptom  The shell-side dependence on private APIs and optional typelibs used to rely on memory, and a hand-copied inventory starts drifting the moment it is written; D-038 is the real cost of "remembering" failing
Change   `scripts/shell-internals.mjs` derives the inventory from code (this machine: 52 shell-side files / 17 private modules / 46 private symbols / 29 files with private dependencies — derived live, never hand-copied), with three rules: a statically imported namespace must be in the guaranteed set, a namespace that has been `await import()`ed must never be statically imported again, and the inventory is checked against the installed libshell for drift
Evidence L0 `node scripts/shell-internals.mjs` `RESULT: PASS`; `test/shell-internals.test.js` is in `npm test`
Cost     The guaranteed set is derived from `gresource list + extract libshell-18.so` (37 namespaces), not my guess at what counts as common. A machine without libshell (CI) prints `INERT`, and that is the word the test asserts — silence must not be read as a pass
Commit   9b996dd

### D-046 · 2026-10-10 · guard · v9
Symptom  The README's key table was hand-copied, and nothing would catch it when key name, default, and range each said something different
Change   `scripts/settings-reference.mjs` renders an 82-key table from the schema (key / type / default / range or options, grouped by the 8 schema paths) and writes it between the `settings-reference` markers of both READMEs; `--check` compares a fresh render against the file contents
Evidence L0 `node scripts/settings-reference.mjs --check` → `RESULT: PASS (82 keys, 8 schema paths)`; `test/settings-reference.test.js` asserts each table's row count equals the key count the script reports, and that both are the same size
Cost     The table **deliberately omits what each item does**: that sentence is owned by each settings row's subtitle (see D-040). Coverage numbers are also read from `settings-coverage.mjs`'s output, not typed by hand
Commit   9b996dd

### D-047 · 2026-10-10 · guard · v9
Symptom  A list like `INVARIANTS.md` — "must stay wrong" — is naturally filled by pasting CHANGELOG sentences until it becomes a second copy; and after the handbook split into `docs/maintenance/`, two new silent failures appeared: a topic page nobody links (which does not exist, so the same fact gets written a second time elsewhere), and citation by section number (the numbers were a property of the old single file and now point at nothing)
Change   `scripts/check-log.mjs --invariants` prints all `kind:fix` entries live (id · date · Commit · Symptom), and zero entries is a failure — an empty invariants list is worse than none, because it looks like it passes; `test/repo.test.js` gains three guards: both INVARIANTS files contain no verbatim CHANGELOG line and must name the command above, every topic file is linked from MAINTENANCE.md, and no `.md/.js/.mjs/.sh` outside `docs/reports/` contains a section number
Evidence L0 poison: append a verbatim CHANGELOG `Symptom` line to `INVARIANTS.md` → `not ok 1`, with the failure naming that line; after restoring, 5/5 green. The section-number guard caught my own newly written page on its first run
Cost     The forbidden character is built with `String.fromCharCode`, not written literally — a guard that spells out what it forbids trips on its own source. The `docs/reports/` exemption was verified in reverse too: adding a number to a dated report must still be green
Commit   aeb5f2f

### D-048 · 2026-10-10 · guard · v9
Symptom  `shell-internals.mjs`'s printed `statically imported namespaces` counted the prefs process's files into the same set, so `Gtk` and `Gdk` appeared on that line — while `docs/maintenance/compatibility-matrix.md` records the negative fact "there is no `gi://Gtk` / `gi://Gdk` in the shell process", putting the instrument and the document in open contradiction. More seriously, rule 2 could not catch shell-side Gtk: the guaranteed set admits those two names so prefs can use Adw/Gtk, making that rule **blind** to them
Change   Split by install set: print `statically imported (shell-side)` and `statically imported (prefs process)`, change `staticallyImported` in `--json` to the shell-side reading, and add `staticallyImportedByPrefsOnly`; `test/shell-internals.test.js` gains a per-process assertion (no Gtk/Gdk on the shell side, and the prefs-only set must be exactly `Adw, Gdk, Gtk`)
Evidence L0 poison: drop a file with `import Gtk from 'gi://Gtk?version=4.0'` into `lib/` → `not ok 3 - no Gtk or Gdk on the shell side, and the prefs-only set is named`; after deleting it, 114/114 green, `RESULT: PASS`
Cost     This also pins down a fact never written down: `Adw` belongs only to the prefs process too, and the shell-side set is Clutter, Cogl, GLib, GObject, GdkPixbuf, Gio, Graphene, Meta, Pango, Shell, Soup, St (12). If the prefs-only set ever changes, the boundary between the two processes has moved, and that assertion goes red first
Commit   9a70edd

### D-049 · 2026-10-10 · fix · v9
Symptom  `logger.error` renders as a shell CRITICAL, and CRITICAL is the line the regression gate counts — so a **recoverable environment condition** permanently reddens this machine's health gate. The rule had previously landed only at the `open()` grab site (D-033) and had never been swept across the class: Gda typelib missing, media-duration probing failing, file info and file preview failing to build, two image-notification decodes, two link-metadata and link-thumbnail cases, stylesheet load failure, `makeStoredPrivate()` missing a chmod (whose comment originally said "never fatal" while the code used error)
Change   After sweeping the whole class (`rg 'logger\.error' extension.js lib`, minus prefs), **9 sites downgraded to `logger.warn`**; the remaining errors meet a single standard: **the user's library or data is genuinely damaged** (prune failure, unrecognised entry type, entry-build exception, Gda/JSON backend failing to start, image-delete and DB-write failures)
Evidence L1 re-ran the headless arms after the change; this round's real-session readings (0 CRITICAL / 0 rejection / 0 disposed) are from the **previous batch of code** — this batch needs a logout to take effect. One stumble in the sweep itself was caught live by L1: `rg '\berror\('` cannot see `.catch(error)`, so deleting that binding made enable() throw `ReferenceError: error is not defined`, which L0 cannot see (`extension.js` cannot be loaded in Node)
Cost     Downgrading moves a class of signal from CRITICAL to warning: **the criterion must count the warn family too**, or a real break becomes invisible instead — the media-duration case is held up by D-052's probe, not by the log level
Commit   0a0368f

### D-050 · 2026-10-10 · fix · v9
Symptom  Two places wrote user content into the journal: `clipboardDialog.js`'s `Unknown item type` printed **the whole entry object** (clipboard body verbatim into `/var/log/journal`); `actionMenu.js` printed **the action's stderr**, and since the action's stdin is the entry body, that command's output can carry a password book straight back. This repo's history is stored in plaintext anyway, and the journal is not private storage
Change   Both now keep only **type and id** (the action keeps the id), no content
Evidence L0 code-reading evidence; `grep` re-checked that these two lines no longer contain `entry` / `stderr`. No instrument covers "no body text in the log" — it needs a new criterion, recorded in open-items
Cost     Debugging a failed action no longer shows stderr directly; you look at the action id and reproduce. A deliberate trade-off
Commit   0a0368f

### D-051 · 2026-10-10 · guard · v9
Symptom  `run.sh`'s log gate counted three shapes (`CRITICAL|JS ERROR`, `Unhandled promise rejection`, `has been already disposed`) and **could not see GLib's own C-side failures**: such a line's message body contains no "CRITICAL", its level and domain living in journald's structured fields (`PRIORITY=4`, `GLIB_DOMAIN=GLib-GObject`). Live: this machine had **27** `g_object_unref: assertion 'G_IS_OBJECT (object)' failed` across boots, and every gate kept reporting 0; after widening the pattern the cross-boot hits rose from 19 to **1720** (the largest family being `clutter_text_{set_text,get_text,get_editable}: CLUTTER_IS_TEXT (self)` at 190 each)
Change   Add a fourth counting section: `assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL`, with the same three-way attribution as disposed (total / a repo stack frame or `Gjs_common_gjs_` within 6 lines / unattributable), **and only the middle tier goes red** — C-side assertions carry no JS stack, so counting them all as ours would false-alarm daily
Evidence L0 verified attribution on synthetic logs: pure foreign → `1 0`, immediately followed by a repo stack frame → `1 1`, mixed → `2 1`; across this round's 39 sessions the total was 0 (this repo genuinely produced none). The attribution conclusion is on record too: this batch is **not this repo's** — two independent pieces of evidence being that `\.unref\(|g_object_unref` has 0 hits on this repo's shell side (GJS throws a TypeError when unref is called on null, so it cannot print a GLib assertion), and that the stack frames near disposed group as shell ui 1664 / Vitals 1590 / notification-grouper 159 / caffeine 105 / blur-my-shell 8 / macos-dock 1 / **copyous 0**
Cost     Two querying pitfalls are recorded together in `docs/maintenance/reading-the-log.md`: case (the message body is lowercase `assertion`, so `grep 'Assertion'` counts 0), and `grep -c` exiting 1 on a zero count, which breaks the `&&` chain — do not read "the chain broke" as "this one was checked"
Commit   03a74a0

### D-052 · 2026-10-10 · guard · v9
Symptom  `gi://Gst` serves only `tryCreateMediaFileInfo()`'s media duration, and that branch had **no instrument coverage**: none of the fixture's 255 rows is a real audio/video file (nor is any row in the real library), so D-038's evidence was only "the extension still loads" — whether a duration appears, and whether it is right, nobody had looked
Change   `make-fixture.js` writes a real 8kHz/16bit mono 3-second WAV, **with a space in the filename** (stored as a percent-encoded URI, matching a copy from the file manager); add `probes/13-media-duration`: the expected duration is **derived from that file's own RIFF header** (`dataSize / (rate * blockAlign)`, not copied from a constant in the code), filter by type down to 5 File rows so windowing brings them into the viewport, then assert the rendered duration label; includes a **negative leg** — a non-audio File row must not grow a duration control
Evidence L1 `live 13` **10/10**; the teeth were tested: making the expectation deliberately +1 second → **FAIL 9/10** printing the real labels `["48","48","KB","KB","3s","3s"]`, then restored byte for byte (`diff` 0 lines). Two GJS API slips were hit while writing it, both recorded in the probe's comments: `GBytes.get_data()` returns the byte array itself, not a `[bytes, size]` tuple; and St's class name needs `get_style_class_name()`, there is no `get_style_classes()`
Cost     What is still uncovered is the **absence branch** (a machine without `gir1.2-gstreamer-1.0`): the typelib is present here so it cannot be produced, and that path has only `test/shell-internals.test.js`'s guaranteed-set criterion + the mechanism-verification evidence from `gjs -m`
Commit   03a74a0

### D-053 · 2026-10-10 · guard · v9
Symptom  In a full 39-session run, after the horizontal arm's `06-ux-hidden` timed out, the remaining 7 probes in the same round all reported `shell never answered Eval` — and those 7 were **not the product**. The timed-out shell (pid 215842) was still alive: main thread `state=S`, `wchan=futex_do_wait`, `utime+stime` unchanged over 6 seconds (so not a busy loop), and it held mutter's wayland lock, so every later session opened with `WL: unable to lock lockfile … maybe another compositor is running` + `libmutter-ERROR: Failed to create_socket`. `down.sh` only sent SIGTERM, and a process blocked in a C call never reaches a signal handler; it exited 1 and printed a WARN for that, but `run.sh` swallowed the line with `>/dev/null 2>&1` — one timeout amplified into eight failures, with nothing in the logs to show they were related
Change   `down.sh`: re-check after TERM, and if anything survives, `escalating to SIGKILL` then re-check again; move the bus-socket deletion to after the re-check (deleting first removes that shell's own socket too, making it un-findable). `run.sh`: capture `down.sh`'s output and exit status, keep the escalation as a single note line, and **on teardown failure `break 2` out of the whole round**, because continuing only mass-produces reds unrelated to the product
Evidence L0 one positive and one negative control (a fake shell with `trap '' TERM`, argv carrying the harness name): `git show HEAD:test/headless/down.sh` → `WARN: 1 harness process(es) survived SIGTERM` + exit 1 + the process still alive; after the change → `escalating to SIGKILL` + `harness down: no … processes left` + exit 0. The first real run after the change hit the same path (horizontal/06 timed out at 450s again), and the log's `note: WARN … escalating to SIGKILL` was immediately followed by `harness down`, with the rest of that round no longer dragged in. Both scripts pass `sh -n`
Cost     Stopping the whole round costs a re-run (20–35 minutes). Why 06 times out is still unresolved (the media path has been excluded with a marker probe; see `docs/maintenance/open-items.md`); this entry only guarantees it no longer infects others
Commit   43b14bc

### D-054 · 2026-10-10 · guard · v9
Symptom  `run.sh` resolved probe names with `ls probes/ | grep "^<prefix>-"`. When one prefix matched two files, `$name` became **two lines**, the assembled eval path did not exist, and: the session still started, the result file never appeared, and 450 seconds later it reported a TIMEOUT with no relation to the product. The trap was mine — I had placed both `99-diag-06.js` and `99-diag-media.js` at the same time, so that round measured this misspelled path and wasted 450 seconds
Change   After resolving the name, count the lines; `>1` prints `ambiguous probe prefix: 99 matches …` and FAILs. **Placed before `up.sh`**, so the rejection is cheap: no session started, no timeout waited
Evidence L0: place an extra `99-diag-zz.js` temporarily → `run.sh live 99` immediately exits 1 printing that line, and `pgrep -cf` counts **0** harness processes (indeed no session started); after deleting the temp file, only 1 file in `probes/` starts with `99`. `sh -n` passes. The two diagnostic files are deleted after use; no `99-*` stays in the repo
Cost     Three lines of shell. What it blocks is "spending a whole round of sessions measuring a filename"; no other side effect
Commit   1b6395a

### D-055 · 2026-10-10 · guard · v9
Symptom  The same `TIMEOUT` said nothing beyond "no result file written", and by the time anyone looked the shell was already killed — all that was left was "the log stops somewhere". In this round's 39 sessions, the unwindowed arm's `06` (10:48:37) and `07` (10:56:39) each hung once, both stopping after `warmup took` with **the dialog never opened** (no `open():` line in the log); on the spot I could only grab `state/wchan/utime` by hand, and the next time even that would be gone
Change   `run_probe`'s timeout branch now **snapshots before teardown**: `ps -o pid,stat,time,wchan:26,rss,args` + `/proc/PID/wchan`, **two majflt samples 2 seconds apart** (the only cheap criterion separating "deadlock" from "this laptop's page-fault storm", whose handling is entirely opposite), a thread-name histogram, per-thread state/wchan, the rc of a `timeout 5 gdbus … Eval '1+1'` (124 = the main loop does not answer, not even SIGTERM gets in), `MemAvailable/SwapTotal/SwapFree`, and the last 8 lines of that shell's log, written to `$OUT/<config>-<name>.stall.txt`. The poll ceiling is made `CO_PROBE_POLL` (default 90 ticks × 5s), so this instrument can be verified in seconds without waiting for a real 450 seconds
Evidence L0 self-check ran on a real nested shell: a temp probe `GLib.usleep(60 * 1000000)` blocking the main loop and writing no result → `CO_PROBE_POLL=2 run.sh live 99` → `TIMEOUT after 10s` + snapshot, the snapshot faithfully reading `SLl / wchan=hrtimer_nanosleep`, `eval rc=124`, `majflt 2 → 2` (**not paging**), `SwapFree 13168384 kB`; the same run also hit D-053's escalation along the way (`ignored SIGTERM, escalating to SIGKILL`). The temp probe is deleted (`ls probes | grep -c '^99'` = 0), `sh -n` passes, and the transcript is left in `docs/reports/stall-snapshot-selftest.txt`
Cost     One extra function that runs only on the red path; zero cost on the green path. It cannot change the hang itself, only make the next hang attributable — immediately re-running `unwindowed 06 07` after those two hangs, both **PASSed** (1/1 and 6/6), so this is intermittent and not reproducible on demand
Commit   3bbc8ae

### D-056 · 2026-10-10 · chore · v9
Symptom  `docs/maintenance/baseline.md`'s L2 column stopped at the 2026-10-07 session (PID 101341), while the shell started at 11:19:34 (PID 350714) was already running the batch of shell-side changes containing `0a0368f` — a baseline page carrying stale readings is more deceptive than none: a reader cannot tell which line is current
Change   Add an L2 column, written by the page's own hard rule (**a reading line beginning with a date must have a reproducible command in the same section**): two timestamps proving code freshness, the enable chain, the `TTI` of four dialog opens, the five print shapes filtered by `_PID=`, `GetExtensionErrors`, `idle-cost.sh 30 3`, and on-disk permissions. The old column is kept, not overwritten, and the two side by side are to be read as direction only
Evidence L2 live: `loaded 93.293ms / filled 127.596ms / warmup 13.917ms`; `TTI 160.189 / 44.510 / 33.636 / 13.522ms`; `page_size` 0px on a cold open, 535px after, resident actors 3→7; `250 matching` (255 rows − 5 pinned); shape counts **CRITICAL 0 / JS ERROR 1 (`ui/dash.js:602 firstIcon`, no repo frame in the stack) / rejection 0 / disposed 0 / GLib assertion 0**; `GetExtensionErrors` = empty array. Idle cost three samples `−0.010 / −0.040 / +0.070` CPU-s, mean 0.007 / 30s window → `NOT MEASURABLE` (same conclusion as the 45-2 column). Permissions: directory 700, `clipboard.db{,-wal,-shm}` and `images/*.png` all 600, `find … -perm /077` no output; after walking `/proc/*/fd` the only process holding the real library open is 350714, so the two 11:28 writes really were this session's
Cost     No behaviour change, no criterion added — who would ask to revert it? Only the next reader, misled by old numbers, so it is filed `chore`. These millisecond values are themselves **not criteria** (session age and warm/cold flip across boots); that sentence belongs to `docs/maintenance/reading-the-log.md`
Commit   fb612a2

### D-057 · 2026-10-10 · guard · v9
Symptom  `06` is the only one of thirteen probes that hangs, and `TIMEOUT` says only "this one did not finish" — which of the eight sections, unknown, and whether it should have taken this long in a 450-second round, also unknown. The five hangs recorded in open-items are spread across two arms and all went green on re-run, so it can neither be reproduced on demand nor attributed
Change   Adopt open-items' (a): `_preamble.js` gains `co.phase(name, budgetMs, fn)`, making **the budget itself the criterion** (`phase:<name>`); `06`'s eight sections each get a budget (`open 30000ms / scroll 60000ms / blink 20000ms / ease·thumb·pin·empty 15000ms / close 10000ms`, all several times the measured values — red means "go look at that section", not "this is slow"). Both legs are needed because the two failure modes are invisible to each other: when an `await` never settles the main loop is still alive and only the deadline can fire; when a synchronous overrun blocks the main thread in C, the deadline cannot fire and only the millisecond count can find it. The scroll loop also gains `STEP_CAP=400` + `scrollLoopNeverCapped` (measured ~82 steps/trip live, 49/horizontal; hitting the cap means the step arithmetic has degraded — exactly the old busy-spin), and `verdict.js` prints the whole phase table when `r.phases` exists. **The same change adds attribution**: `co.phase` `print`s a `[copyous-probe] phase <name> start …` line before starting, and D-055's snapshot gains a `probe phases reached:` section that fishes it out of the log — on the C-blocked path neither the deadline nor the result file appears, so this log line is the only thing that can still say "which section was running"
Evidence L0 teeth, three items: (1) each leg went red once (`docs/reports/phase-cap-teeth.json`) — `phase:overrun = {"outcome":"done","ms":2001,"budgetMs":500}`, `phase:never = {"outcome":"deadline","ms":1501,"budgetMs":1500}`, `FAIL 1/3 checks`, exit 1, zero of the five print shapes (`g_source_remove` removes only sources that never fired, avoiding a GLib-GSource false alarm); (2) the marker survives in the noise (`docs/reports/phase-marker-teeth.txt`) — within a 30000ms budget, print 200 warning lines then `usleep(120 * 1000000)`, `CO_PROBE_POLL=2` → `TIMEOUT after 10s`, the snapshot writes `wchan=hrtimer_nanosleep` and `probe phases reached: … marker-proof start`, while the same snapshot's `log tail:` holds only noise lines 192–197 ⇒ `tail` alone can never see it; (3) criteria only grow, never shrink — the `chk/rec/metric` key sets are mechanically `diff`ed, none of the old 16 lost, with `scrollLoopParams` and `scrollLoopNeverCapped` added. L1 two rounds of `run.sh all 06` (`docs/reports/06-phasebudget-three-arms.txt`): round one `live PASS 15/15`, `unwindowed PASS 5/5`, `horizontal TIMEOUT after 450s` (snapshot pid 410229: `futex_do_wait`, `majflt 9 → 9` ⇒ not paging, `eval rc=124`, thread table showing `wavparse0:sink`/`typefind:sink`); round two **all three arms green** (`live 15/15`, `unwindowed 5/5`, `horizontal 15/15`, `per=262 rowsPerViewport=5 max=64237`), zero of each shape
Cost     **The budget itself did not catch this hang**, and that must be stated plainly: in the horizontal case the main thread was blocked in C, so neither the deadline nor the phase table could fire, and what worked on that path was the pre-start log line + (c)'s snapshot grep. The cost is admitting that sectioning changes the phenomenon, plus one extra `Promise.race` per section. A suspect is ruled out along the way: concurrent media probing is not the cause — re-run to keep the artifact (`docs/reports/media-race-concurrency.txt`: two pipelines in flight at once, each with the 50ms poll, both settling in 53ms, `PASS 2/2`; without polling it returns in 12ms but `ok=false`, `dur=-1`, i.e. an immediate query never gets a duration anyway), and the previous round's unarchived readings (58ms/54ms) have been withdrawn from the text. A tooling pitfall hit on the re-run is recorded: in `Eval`, `await import('gi://Gst')` without enabling first never settles the promise; use `imports.gi.Gst` instead. The temp probe is deleted (`ls probes | grep -c '^99'` = 0). (b) the bisection is still undone, awaiting a go-ahead
Commit   4e763a9, c949791

### D-058 · 2026-10-10 · guard · v9
Symptom  All five shapes of the log gate count "how many times a word class appears", and **none reads content**. The two journal leaks this repo fixed happen to be in none of those five — `clipboardDialog.js` printing the whole entry object and `actionMenu.js` printing the action's stderr land in the log as a line of **ordinary body text**, shape-indistinguishable from an innocent log; before this round they were caught by a human reading the log. Along the way, an instrument-scope issue: `$OUT/*.shell.log` was overwritten by same-named `(config, probe)` and **never cleaned**, so "across all sessions" really meant "across every session this directory has ever held" — this round counted 50 historical logs mixed in, so a diagnostic probe deleted last week could leave a red alive today
Change   `run.sh` gains a **body-text sentinel** at the end: the phrase table is **extracted by the new script `test/headless/fixture-phrases.mjs` from `make-fixture.js` itself** (two phrase pools, `CJK`/`LATIN`, plus the three structural markers of the generated code bodies — 14 in all); failing to extract exits 3 and `run.sh` records FAIL — an empty list would leave the sentinel permanently green, worse than no sentinel. On a hit, `-H -n -o` reports only **file, line number, which phrase matched**, never printing the line itself (this gate must not become the leak it checks). What is matched is phrases, not digits, so legitimate numbers like ids/durations/byte counts/`250 matching` pass by nature. The same batch makes each run clear `*.shell.log` first (`*.json` and `*.stall.txt` untouched)
Evidence L0 teeth, four items, all run on real nested shells: (A) a temp probe `99-leak.js` deliberately prints one line of fixture body → the probe itself `PASS 1/1`, while the gate reports `fixture body text in session logs: 1 line(s) across 1 session(s)` + `RESULT: FAIL` (the gate is red, not the product), full text in `docs/reports/sentinel-teeth.txt`; (B) each of the extractor's three failure modes produced once — pool renamed → `exit=3 FATAL: no \`const CJK = [\``, body wording changed → `no longer contains "lorem ipsum dolor sit amet"`, code marker changed → `no longer contains "of fixture snippet"`, each restored byte for byte afterward asserting `git status --porcelain test/headless/make-fixture.js` = 0 lines; (C) clearing works: any run after the sentinel step reports `0 line(s) across 1 session(s)` instead of the historical 50; (D) the sentinel scores 0 hits in normal three-arm runs (`live 01`, `live 06`, two rounds). Before the `-H` fix, that report with only one log printed as `23:会议纪要…` — **no filename**, and a shape like that, missed once, leaves no way to tell which session leaked
Cost     One extra `grep -F` per session (14 fixed strings, no regex). Who would ask to revert it: if a future probe **deliberately** writes body text into the log for an experiment, it must change the sentinel too (intentional friction, not a bug). The temp probe is deleted (`find test/headless/probes -name '99-*' | wc -l` = 0)
Commit   919bd60

### D-059 · 2026-10-10 · guard · v9
Symptom  The intermittent hang in open-items, recorded a sixth time, still said only "06 did not finish". D-057's budgets are mute to it (when the main thread is in C, neither the deadline nor the result file appears), so what (b)'s bisection lacks is not patience but **an actionable boundary**: with no section names, "exclude section by section" cannot be executed
Change   Two things. ① `CO_SKIP_PHASES=<a,b>` cuts the named sections out of the probe entirely (a diagnostic knob, not changing what the criteria mean), and `done()` gains the guard `everyRequestedSkipRan`: a name requested for skipping must actually have been skipped, else FAIL — without it, a misspelled section name buys a green that bisected nothing. ② The scroll loop prints **two** markers per step (`step=i` and `step=i assigned value=…ms`): the first named hang stopped at `scroll pass=0 step=49`, but it cannot say whether what stuck was that `adj().value=` re-layout or the `sleep` after it, and the two culprits are handled completely differently
Evidence L0 teeth: `CO_SKIP_PHASES=bogusPhaseName run.sh live 01` → `✗ everyRequestedSkipRan = "named in CO_SKIP_PHASES but never skipped: bogusPhaseName"` + `RESULT: FAIL`; `CO_SKIP_PHASES=scroll run.sh live 06` → `PASS 14/14`, phase table `scroll=0/60000ms(skipped)`. L1 batch 1, twelve runs (`/tmp/bisect-06.log`): `live` with scroll 5 runs green, `live` skipping scroll 5 runs green, `horizontal` run 1 green, **run 2 hung** → the marker section in `docs/reports/bisect-stall-run12-horizontal.txt` is `scroll pass=0 step=38…49`; the horizontal geometry's (`per=262 rowsPerViewport=5 max=64237`) loop upper bound is exactly i=49 (`49×1310=64190 ≤ 64237 < 50×1310`) ⇒ **stuck at the "scroll to the very bottom" step**. Another named sample: 13:05:56 `live` arm pid 467398, `futex_do_wait`, `majflt 8 → 8`, `eval rc=124`, with only `open` and `scroll` as marker lines (`docs/reports/stall-live-06-named-scroll.txt`)
Cost     Only **two of seven** samples carried a section name, both in `scroll`, but "5 runs with scroll skipped all green" does not constitute a verdict at an incidence around 25% (P(5 runs not hanging) is itself ≈0.73), so this entry stops at "the boundary can now be executed" and does not reach "the cause is scroll". Two markers per step lengthen the log by a few hundred lines; single-run cost showed no measurable difference (the `scroll` section of a green run is still 11–17 seconds). Batch 2 (30 runs, including 4 horizontal runs with scroll skipped) exists to turn this "direction" into something decidable; if the conclusion changes after it runs, that is recorded as another entry, not by editing this one
Commit   919bd60, 4f26e87

### D-060 · 2026-10-10 · guard · v9
Symptom  `test/headless/up.sh` isolated the D-Bus socket and XDG_DATA/CACHE/CONFIG but never `XDG_RUNTIME_DIR`, so the nested `gnome-shell --headless` resolved its Wayland socket and wrote the "safe mode" marker into the *live* `/run/user/$UID`. That left `gnome-shell-disable-extensions` in the real runtime dir until a logout cleared it, and once a concurrent session's measurement was polluted by it
Change   `up.sh` now creates `$WORK/runtime` (mode 0700, as the runtime-dir spec requires) and exports it as `XDG_RUNTIME_DIR` before launching the nested shell. The isolation rules already stated in AGENTS.md are unchanged; this closes the one directory they missed. Nothing outside reads the socket — `run.sh` waits on D-Bus Eval — so the probes are unaffected
Evidence L1, measured: after the change `up.sh` starts the shell, `$WORK/runtime` holds `wayland-copyous-harness`, its `.lock` and `gnome-shell-disable-extensions`, while the real `/run/user/1000` still lists only the session's own `wayland-0` (no copyous socket, no marker); the nested shell answers `gdbus … org.gnome.Shell.Eval 'global.display.get_n_monitors()'` → `(true, '1')`; `down.sh` reports "no wayland-copyous-harness processes left". `npm test` 114/114
Cost     None for the product. A `wayland-copyous-harness` socket left in a real runtime dir by a *pre-fix* run is not cleaned by this — a logout is still how that goes away
Commit   9254ce1
