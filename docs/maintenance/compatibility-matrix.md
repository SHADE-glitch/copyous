# Platform requirements and upgrade checklist

What this extension needs, which combinations have actually been verified on this machine, and in what order to check when GNOME has a major upgrade.

> **Origin**: the first three rules in the body were moved verbatim from items 1, 3, and 5 of section 8 of `MAINTENANCE.md` (520 lines / 12 sections before the split);
> the two tables below were looked up live on this machine on 2026-10-09, and every number can be re-fetched with the command on its row.
> This file is the sole owner of these facts; do not restate them elsewhere.

## 1. Three rules that do not change

Upstream is frozen at 2.0.1, so every GNOME major upgrade is this file's business:

1. `metadata.json`'s `shell-version` is currently `["48","49","50"]`. **Without changing it, the extension simply does not load on a new shell.**
   This is a deliberate safety gate (better not to load than to run half-broken), but on upgrade it must be added to by hand.

2. The first thing after an upgrade is `./test/headless/run.sh all`, because if the behaviour of the `--headless` / `--unsafe-mode` /
   `--virtual-monitor` flags changes, the whole verification silently stops working. `up.sh` prints them.

3. `Math.clamp` is not a JS built-in; it is injected by the shell. `lib/common/color.js` depends on it, so
   `test/color.test.js` installs a shim; new tests that can run under Node need the same shim.

## 2. Combinations measured on this machine (2026-10-09)

**Only this column has actually been run.** Declaring support ≠ verifying it; the value of this table is precisely that last column.

| Layer | Measured value here | Re-fetch command | How far it is verified |
| --- | --- | --- | --- |
| Distribution | Ubuntu 26.04.1 LTS | `grep PRETTY_NAME /etc/os-release` | The only distribution tested; other distributions **unverified** (`libgda`'s soname differs on Debian/Arch) |
| Session type | Wayland | `echo $XDG_SESSION_TYPE` | Both the real session and headless are Wayland; **X11 has never loaded this extension** |
| GNOME Shell | 50.1 | `gnome-shell --version` | Run-verified: real session + 36 headless sessions |
| shell internal ABI | `libshell-18.so`, `Meta-18.typelib`, `Clutter-18.typelib` | `ls /usr/lib/gnome-shell/ /usr/lib/x86_64-linux-gnu/mutter-18/` | Run-verified — [shell-internals.md](shell-internals.md)'s 46 symbols all rest on this 18 |
| gjs | 1.88.0 | `gjs --version` | Indirectly verified (every line of JS runs on it, including the separate `test/prefs/` process) |
| GLib / GIO | 2.88.0 | `dpkg-query -W -f='${Version}\n' libglib2.0-0t64` | Run-verified (`GLib.chmod`, `GdkPixbuf`, `Gio.Settings` all rest on it) |
| GTK / libadwaita | `Gtk-4.0.typelib`, `Adw-1.typelib` | `ls /usr/lib/x86_64-linux-gnu/girepository-1.0/` | **prefs process only**: `test/prefs/run.sh` builds 86 rows and 74 icon buttons for real under Xvfb, 5/5 green. No Gtk/Gdk in the shell process (compliant, see section 4) |
| libgda | 5.2.10, `Gda-5.0.typelib` | `dpkg -S /usr/lib/x86_64-linux-gnu/girepository-1.0/Gda-5.0.typelib` | **This is what the live backend actually uses**: `database-backend='sqlite'` ⇒ `initSqlite()` ⇒ `await import('gi://Gda')`. Gda 6 unverified; the `DEBUG_COPYOUS_GDA_VERSION` env var is the manual knob left for version mismatch |
| SQLite | 3.46.1 | `dpkg-query -W -f='${Version}\n' libsqlite3-0` | The `sqlite3` CLI is used only to **read** (always `file:…?mode=ro`); the write path is entirely inside libgda |
| JSON backend | Code exists, not enabled here | `gsettings get … database-backend` | **Unverified** — live is `sqlite`, and the `json` branch has only `lib/database/json.js`'s own code-reading evidence |
| highlight.js | v11.11.1, 127k, installed at `~/.local/share/copyous@local/highlight.min.js` | `head -2 ~/.local/share/copyous@local/highlight.min.js` | Run-verified (Code entry highlighting goes through it). The `languages/` directory holds only **1** language pack (dockerfile); other languages fall back to the main bundle via `getHljsPath()` |
| GStreamer | 1.28.2 + `Gir1.2-gstreamer-1.0` | `ls /usr/lib/x86_64-linux-gnu/girepository-1.0/Gst-1.0.typelib` | The success branch is **run-verified** (since 2026-10-10): `make-fixture.js` now writes a real WAV of known duration (name with a space, so a percent-encoded URI is stored), and probe 13 derives the expected duration from the file's own RIFF header then checks the duration badge rendered on the entry, `live 13` = 10/10. **The absence branch still cannot be produced on this machine** (the typelib is installed); that path has only `test/shell-internals.test.js`'s guaranteed-set criterion and the mechanism-verification evidence from `gjs -m` |
| GSound | `GSound-1.0.typelib` | same directory | Unverified — dynamically loaded, headless has no sound device, and the copy-sound branch has never run |
| libsoup | 3.0 | same directory | Unverified — used only to fetch link-card titles; headless deliberately has no network (the fixture presets `metadata.title`), so this network path has never run once |
| Node | 22.22.1 here, 20 in CI | `node --version` | Deliberate split: the five pure-module unit tests + four repo guards run on Node (20 is enough for CI); `test/headless/make-fixture.js` uses `node:sqlite` and **needs ≥22.5**, and CI never runs it. CI green ≠ the data-generating script runs on CI's Node — do not conflate the two |

## 3. Dependencies come in three tiers; getting the tier wrong produces a wrong "compatibility"

| Tier | Members | What happens if missing |
| --- | --- | --- |
| **Hard (shipped with the shell)** | `gi://Shell`, `St`, `Clutter`, `Meta`, `Gtk`, `Adw`, `Pango`, `Graphene`, `Cogl` | Injected by the shell process, so present whenever it is installed; missing means not running on GNOME at all |
| **Optional, and the code knows** | `gi://GSound` (sound effects), `gi://Gda` (persistence other than JSON/Memory), `highlight.min.js` (code highlighting) | Dynamic load + explicit fallback: Gda missing ⇒ history falls back to memory or json and shows one notification (`disable-gda-warning` governs this notification), GSound missing ⇒ silent, hljs missing ⇒ plain-text code + one dismissible install prompt |
| **Optional, but the code once did not know** | `gi://Gst` (media duration) | **F19, fixed 2026-10-09**: originally a top-of-file `import Gst from 'gi://Gst'`, and every consumer depended on it at module-resolution time ⇒ on a machine without `gir1.2-gstreamer-1.0` **the whole extension failed to load**, just to avoid showing one duration. Now moved to `await import()` inside `tryCreateMediaFileInfo()` + a `logger.warn` fallback. Guard = `test/shell-internals.test.js` (the criterion being "any namespace that has been `await import()`ed must never be statically imported again", the set derived from the code, not a hard-coded list); the duration itself is guarded since 2026-10-10 by **probe 13** (the duration of the real WAV in the fixture is derived from the RIFF header, not read from a constant in the code) |

**This criterion is worth remembering on its own**: whether a typelib is optional is not read from docs but from **whether the code has ever dynamically loaded it**.
Having loaded it means the author decided it can be missing and handled the absence; at that point any static import is self-contradictory, and the failure
mode is "the whole extension does not load", not "this feature is missing".

## 4. Two negative facts (also compatibility information)

- **There is no `gi://Gtk` / `gi://Gdk` in the shell process**. The check command (mind the `\b`; `gi://GdkPixbuf` masquerades as `gi://Gdk`):

  ```sh
  grep -rlE "gi://(Gtk|Gdk)\?" lib/ extension.js thirdparty/ | grep -v '^lib/preferences/'
  ```

  Empty output is correct. Historically, having missed this boundary, I misreported `GdkPixbuf` as "Gtk leaking into the shell" — that was **false**.
  This no longer needs a human running grep: `node scripts/shell-internals.mjs` prints the two install sets separately
  (`statically imported (shell-side)` and `statically imported (prefs process)`, the latter live being
  `Adw, Gdk, Gtk`), and `test/shell-internals.test.js` asserts those two names do not appear on the shell side and that the prefs-only
  set is exactly these three — a change in the set means the boundary between the two processes has moved.
  (Before this, the instrument's print line did not split by process and counted the prefs side's Gtk/Gdk into the "static import set", which looked like it was
  denying this very fact; this negative fact was unverifiable then.)
- **There is no build step**. `gschemas.compiled` and the two `.gresource` files are artifacts committed to the repo, so
  this machine needs neither glib-compile-schemas nor glib-compile-resources. Even installed, they should not be run — when the artifacts produced
  do not match what is committed, sorting out whether it is the source or the artifact that changed is another pit in itself.

## 5. Upgrade checklist (in order, do not skip)

1. `gnome-shell --version` to record the new value; `ls /usr/lib/gnome-shell/` to see whether the ABI number (`libshell-NN.so`) changed.
2. `node scripts/shell-internals.mjs > /tmp/internals-new.txt` and diff against the previous version:
   **a symbol disappearing** shows up earlier than a rename, and this step is the only place that can see it.
3. `./test/headless/run.sh all` — if any of the three flags stops working, this goes red first (section 1, item 2).
4. `./test/prefs/run.sh` — the settings window is another process; the shell side being all green does not mean it is fine.
5. `npm test` — the five pure modules + four repo guards, of which `test/shell-internals.test.js` guards the criterion in section 3.
6. Real session: log out and back in, read the journal against the baseline (see [reading-the-log.md](reading-the-log.md),
   [baseline.md](baseline.md)). headless can only prove "does not crash, does not violate", not "the feel is unchanged".
7. Only after all green, touch `metadata.json`'s `shell-version`, and only then the `version` integer (see AGENTS.md's
   Release / version section — if the integer does not rise, the user gets no update).

## 6. Known unverified combinations (do not treat as supported)

X11 sessions; GNOME 48 / 49 (this machine has only 50.1, which is exactly the gap between declared and verified); non-Ubuntu distributions;
the `json` and `memory` values of `database-backend`; GSound sound effects; Soup network title fetching;
GStreamer media duration; `libgda` 6.x.

These ten are **not to-dos** — they are the first ten places to look the next time someone says this extension is broken in some environment.
