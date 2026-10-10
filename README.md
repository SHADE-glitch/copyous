<p align="right"><a href="README.md"><b>English</b></a> | <a href="README.zh-CN.md">简体中文</a></p>

# Copyous — Local Maintenance Fork

A modern clipboard manager for GNOME.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Based on: Copyous](https://img.shields.io/badge/based%20on-Copyous-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/copyous)

## 📖 About

This repository is a **personal maintenance fork** of [**Copyous**](https://github.com/boerdereinar/copyous) by **boerdereinar**, frozen at upstream **2.0.1** and maintained locally under the UUID `copyous@local`.

It is **not** affiliated with or endorsed by the upstream author. The fork preserves the upstream feature set and focuses on **correctness, security, performance and resource management** — notably parameterising the SQLite queries, tuning the database, and eliminating leaks on enable/disable.

> Copyous itself is a full rewrite of the [Pano](https://github.com/oae/gnome-shell-pano) clipboard manager.

## ✨ Features

- **Clipboard history** for text, code, images, files, links, characters, colors and QR codes.
- **SQLite backend** via GNOME Data Access (Libgda 5 or 6), with JSON and in-memory alternatives.
- **Search** across history, plus **pinning**, **nine colored tags**, and an **incognito** mode.
- **Customizable actions** (`actions.json`) — run commands, open colors, generate QR codes.
- **Paste-on-copy**, primary-selection sync, and per-application (WM class) exclusions.
- **Theming** via GResource, optional **highlight.js** syntax highlighting, and **GSound** feedback.
- **D-Bus interface** (`org.gnome.Shell.Extensions.Copyous`) to show, hide, toggle and clear history.
- **82 GSettings keys** and **8 translations** (de, fr, it, pl, pt_BR, ru, tr, zh_CN).

## 🧰 Prerequisites

| Requirement | Details |
|---|---|
| OS | Ubuntu (verified on Ubuntu 26.04) — other distributions are **unverified** |
| GNOME Shell | 48 – 50 |
| Libgda | Libgda 5.0 or 6.0 **with SQLite support** |
| GSound | Optional, for notification sounds |

```bash
# Ubuntu / Debian (verified)
sudo apt install gir1.2-gda-5.0 gir1.2-gsound-1.0

# Untested on this fork — package names only, listed for reference:
# Fedora
sudo dnf install libgda libgda-sqlite gsound
# Arch Linux
sudo pacman -S libgda6 gsound
# openSUSE
sudo zypper install libgda-6_0-sqlite typelib-1_0-Gda-6_0 typelib-1_0-GSound-1_0
```

## 📥 Installation

```bash
git clone https://github.com/SHADE-glitch/copyous.git ~/.local/share/gnome-shell/extensions/copyous@local
gnome-extensions enable copyous@local
```

On Wayland you must log out and back in for GNOME Shell to load the extension.

### Uninstall

```bash
gnome-extensions disable copyous@local
rm -rf ~/.local/share/gnome-shell/extensions/copyous@local
```

## 🖱️ Usage

Open the clipboard dialog with `Super` `Shift` `V`, or from the panel indicator.

| Action | Shortcut |
|---|---|
| Open clipboard dialog | `Super` `Shift` `V` |
| Toggle incognito mode | `Super` `Shift` `Ctrl` `V` |
| Copy item | `Enter` / `Space` |
| Run default action | `Ctrl` `Enter` / `Space` |
| Pin item | `Ctrl` `S` |
| Delete item | `Delete` (hold `Shift` to force) |
| Jump to item | `Ctrl` `0` … `9` |
| Toggle pinned search | `Alt` |
| Cycle item type | `Ctrl` `Tab` / `Shift` `Ctrl` `Tab` |

## ⚙️ Preferences

Open **GNOME Settings → Extensions → Copyous → Settings** to configure the database backend and location, appearance and theming, indicator and dialog behavior, notification sounds, keyboard shortcuts, tags and actions.

The window has four pages: **General** (History, Feedback, Behavior, Exclusions, Dependencies, Locations), **Customization** (Profiles, Dialog, Item, Header, Items, Theme), **Shortcuts** (Dialog, Item, Item Activation, Filter Menu, Navigation, Search, Search Filters, Search Scrolling) and **Actions** (Actions, Defaults, Built-In Actions).

Two things about that window are guaranteed, and both are checked by a command rather than by
promising them here:

- **Every row that changes a value explains what it changes** in its subtitle, every group has a
  title, and every icon-only button has a tooltip -- `./test/prefs/run.sh` builds the real widget
  tree under Xvfb and fails if a row is added without one.
- **Every setting can be put back.** Each row owns an undo button that resets just that value; it
  stays visible and greyed once the value is already the default. `node scripts/settings-coverage.mjs`
  fails the build if a key loses its way back.

The behaviour that the label alone does not tell you about:

| Setting | What actually happens |
|---|---|
| Dynamic item height | This is the switch for **viewport windowing**. Off (the default here) means only the visible rows exist as actors, which is what makes a 250-item list open fast; on means every row is built and kept. The **Compact** profile sets it back on, so choosing Compact silently gives the windowing benefit away -- if the dialog feels slow again, check this first. |
| History length | Bounds *pruning*, not display. The dialog renders every row the database holds, and pinned/tagged items are never pruned, so a longer list is what you see if you pin a lot. |
| Paste on copy | Removed from the window on purpose: it is folded into **Swap Copy/Paste Shortcut** by the migration in `lib/common/settings.js`, which resets it. |
| Send notifications | The image preview in a notification decodes the picture on the main thread, about **24–46 ms** per copied image (measured). One pass, not two, is already the fix; the remainder is a known cost of the feature. |
| Wiggle indicator | Uses the shell's own shake animation; nothing to configure beyond on/off. |
| Disable Gda warning | Silences **both** "Failed to load Gda" notifications -- the one raised when the typelib cannot be loaded and the one raised when the database itself throws. Honouring only the first (as upstream did) made the switch look like it did nothing on the path that actually fails. |
| Ask to Install Highlight.js | The inverse of `disable-hljs-dialog`, whose only writer was the **Cancel** button of that download prompt: cancelling once used to hide the prompt for good, with no way back. Pressing it off reproduces the old behaviour; a successful install turns it back on by itself. |

### Every key, with its type and default

Generated from the schema, so it cannot advertise a setting that does not exist or hide one
that does. Refresh with `node scripts/settings-reference.mjs --write`; the `npm test` suite
checks the block is current.

<!-- settings-reference:start -->
### `(root)`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `incognito` | boolean | `false` | — |
| `disable-gda-warning` | boolean | `false` | — |
| `disable-hljs-dialog` | boolean | `false` | — |
| `in-memory-database` | boolean | `false` | — |
| `database-backend` | enum | `'default'` | default / memory / sqlite / json |
| `database-location` | string | `''` | — |
| `clipboard-history` | enum | `'keep-pinned-and-tagged'` | clear / keep-pinned-and-tagged / keep-all |
| `history-length` | integer | `50` | 10 – 500 |
| `history-time` | integer | `0` | 0 – 1440 |
| `remember-search` | boolean | `false` | — |
| `exclude-pinned` | boolean | `false` | — |
| `exclude-tagged` | boolean | `false` | — |
| `protect-pinned` | boolean | `true` | — |
| `protect-tagged` | boolean | `true` | — |
| `paste-on-copy` | boolean | `true` | — |
| `sync-primary` | boolean | `false` | — |
| `update-date-on-copy` | boolean | `true` | — |
| `show-indicator` | boolean | `true` | — |
| `show-content-indicator` | boolean | `false` | — |
| `wiggle-indicator` | boolean | `true` | — |
| `send-notification` | boolean | `false` | — |
| `sound` | string | `'none'` | — |
| `volume` | double | `0.0` | -20.0 – 20.0 |
| `wmclass-exclusions` | unknown | `[]` | — |
| `show-at-pointer` | boolean | `false` | — |
| `show-at-cursor` | boolean | `false` | — |
| `clipboard-orientation` | enum | `'horizontal'` | horizontal / vertical |
| `clipboard-position-vertical` | enum | `'top'` | top / left / center / bottom / right / fill |
| `clipboard-position-horizontal` | enum | `'fill'` | top / left / center / bottom / right / fill |
| `clipboard-size` | integer | `500` | 200 – 10000 |
| `clipboard-margin-top` | integer | `6` | 0 – 10000 |
| `clipboard-margin-right` | integer | `6` | 0 – 10000 |
| `clipboard-margin-bottom` | integer | `6` | 0 – 10000 |
| `clipboard-margin-left` | integer | `6` | 0 – 10000 |
| `auto-hide-search` | boolean | `false` | — |
| `show-scrollbar` | boolean | `true` | — |
| `item-width` | integer | `250` | 200 – 1000 |
| `item-height` | integer | `170` | 50 – 1000 |
| `dynamic-item-height` | boolean | `false` | — |
| `tab-width` | integer | `4` | 1 – 8 |
| `show-header` | boolean | `true` | — |
| `header-controls-visibility` | enum | `'visible'` | visible / visible-on-hover / hidden |
| `show-item-title` | boolean | `true` | — |
| `open-clipboard-dialog-shortcut` | unknown | `['&lt;Super&gt;&lt;Shift&gt;v']` | — |
| `toggle-incognito-mode-shortcut` | unknown | `['&lt;Super&gt;&lt;Control&gt;&lt;Shift&gt;v']` | — |
| `open-clipboard-dialog-behavior` | enum | `'toggle'` | toggle / open-or-select-next |
| `pin-item-shortcut` | unknown | `['&lt;Control&gt;s']` | — |
| `delete-item-shortcut` | unknown | `['Delete']` | — |
| `edit-item-shortcut` | unknown | `['&lt;Control&gt;e']` | — |
| `edit-title-shortcut` | unknown | `['&lt;Control&gt;t']` | — |
| `open-menu-shortcut` | unknown | `['&lt;Control&gt;a']` | — |
| `middle-click-action` | enum | `'pin'` | none / pin / delete |
| `swap-copy-shortcut` | boolean | `false` | — |
| `swap-scroll-shortcut` | boolean | `false` | — |

### `(root).text-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `show-text-info` | boolean | `false` | — |
| `text-count-mode` | enum | `'characters'` | characters / words / lines |

### `(root).code-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `syntax-highlighting` | boolean | `true` | — |
| `show-line-numbers` | boolean | `true` | — |
| `show-code-info` | boolean | `false` | — |
| `text-count-mode` | enum | `'characters'` | characters / words / lines |

### `(root).image-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `show-image-info` | boolean | `false` | — |
| `background-size` | enum | `'cover'` | cover / contain |

### `(root).file-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `file-preview-visibility` | enum | `'file-preview-or-file-info'` | file-preview / file-info / file-preview-or-file-info / file-preview-and-file-info / hidden |
| `file-preview-types` | flag set | `['text','image','thumbnail']` | — |
| `file-preview-exclusion-patterns` | unknown | `[]` | — |
| `background-size` | enum | `'cover'` | cover / contain |
| `syntax-highlighting` | boolean | `true` | — |
| `show-line-numbers` | boolean | `true` | — |

### `(root).link-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `show-link-preview` | boolean | `true` | — |
| `show-link-preview-image` | boolean | `true` | — |
| `link-preview-image-background-size` | enum | `'contain'` | cover / contain |
| `link-preview-orientation` | enum | `'vertical'` | horizontal / vertical |
| `link-preview-exclusion-patterns` | unknown | `[]` | — |

### `(root).character-item`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `max-characters` | integer | `1` | 1 – 4 |
| `show-unicode` | boolean | `false` | — |

### `(root).theme`

| Key | Type | Default | Range / choices |
|---|---|---|---|
| `theme` | enum | `'default'` | default / yaru / custom |
| `color-scheme` | enum | `'system'` | system / dark / light / high-contrast |
| `custom-color-scheme` | enum | `'dark'` | dark / light / high-contrast |
| `custom-bg-color` | string | `''` | — |
| `custom-fg-color` | string | `''` | — |
| `custom-card-bg-color` | string | `''` | — |
| `custom-search-bg-color` | string | `''` | — |

82 keys across 8 schema paths. Every key with a control has a row in the settings window, and the undo button on that row is the way back to its default (**79 of 79** controls covered -- `node scripts/settings-coverage.mjs` proves it). The subtitle under each row says what the setting changes, and that row is the only owner of that sentence. Generated by `node scripts/settings-reference.mjs --write` -- do not edit by hand.
<!-- settings-reference:end -->

## 🧯 Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| The extension does not appear at all | `metadata.json` declares `shell-version` `48`–`50`; a shell outside that range refuses to load it. This is deliberate -- a mismatched private-API load is worse than no extension. | `gnome-shell --version`, then see [docs/maintenance/compatibility-matrix.md](docs/maintenance/compatibility-matrix.md) |
| History is empty after every logout | The SQLite backend goes through **libgda**. Without `gir1.2-gda-5.0` (or 6) the tracker falls back to an in-memory store, and the notification that used to say so may have been silenced. | `gsettings get org.gnome.shell.extensions.copyous database-backend` (see the note below about `GSETTINGS_SCHEMA_DIR`), or read the log line `Failed to load Gda` |
| A change to the code does nothing | `disable` + `enable` **does not re-import** any module: GJS caches ES modules for the whole shell lifetime. | Log out and back in (or restart the session). Code under `lib/preferences/**` is the exception -- it runs in its own process, so opening the settings window again is enough |
| The item menu is empty, or the Actions page shows an error | `~/.config/copyous@local/actions.json` parsed but had no `actions` array (hand-edited, truncated save). The extension now falls back to the built-in defaults and logs a `warn`, so nothing is permanently broken. | Delete the file and let it regenerate, or restore it from a backup |
| Syntax highlighting is missing | `highlight.min.js` is downloaded into `~/.local/share/copyous@local/`, not installed as a package here. | **Settings → General → Dependencies** asks once; **Ask to Install Highlight.js** controls whether it asks again |
| The input-method candidate window is offset from the text | Candidate placement follows the shell's `inputMethod` cursor signal, which only knows where the shell thinks the caret is. | Report it with the input method and language you were using -- it is a shell interaction, not a stored value |
| One setting is stuck and you cannot find the row | The schema is **not** registered system-wide (the extension ships `schemas/gschemas.compiled` and no build step), so plain `gsettings` answers `No such schema`. | Read it: `GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/copyous@local/schemas gsettings describe org.gnome.shell.extensions.copyous <key>` -- that form is what was run here. Swapping `describe` for `reset` clears one value the same way, but it writes your live dconf, so it was deliberately not executed while documenting this. The row's own undo button does the same thing and cannot hit the wrong key |
| Something looks slow and you want to know if it is us | Idle CPU cost is measured by differencing one headless shell with and without the extension, and the answer on 2026-10-09 was **below the instrument's resolution** -- so idle is not the explanation. | `./test/headless/idle-cost.sh 45 2`, then [docs/maintenance/cost-measurement.md](docs/maintenance/cost-measurement.md) for what the numbers can and cannot prove |
| After a GNOME major upgrade, unknown state | Four independent gates, in ascending cost order. | `npm test` → `node scripts/shell-internals.mjs` → `./test/prefs/run.sh` → `./test/headless/run.sh live`, then log in once and read the journal |

Where your data lives, and who can read it: history in `~/.local/share/copyous@local/clipboard.db`
(plaintext SQLite, plus `images/`), actions in `~/.config/copyous@local/actions.json`, cache in
`~/.cache/copyous@local/`. Since 2026-10-09 every file and directory the extension creates or
inherits is `0600`/`0700`, corrected at every `enable()` -- see
[docs/maintenance/database.md](docs/maintenance/database.md).

## 🧪 Testing

Four modules carry no GNOME/GI imports, so they run under plain Node — no `gjs`, no dependencies, no build step. A fifth suite guards the repository rather than the code:

```
npm test
```

- `lib/common/color.js` → `test/color.test.js` (per-space clamping, hue normalization, parse precedence, invertible conversions)
- `lib/common/glob.js` → `test/glob.test.js` (anchoring, `/`-aware wildcards, globstar, character classes, brace expansion, metacharacter escaping)
- `lib/common/settings.js` → `test/settings.test.js` (binding lifecycle, and the `paste-on-copy` migration)
- `lib/misc/actor.js` → `test/actor.test.js` (visible-only traversal and its edges)
- the repository itself → `test/repo.test.js` (the two-file bilingual README pair stays in step; no markdown anywhere in the tree uses task checkboxes)

`lib/common/color.js` relies on `Math.clamp`, a global that GNOME Shell injects, so the color suite installs that one-line definition before building a `Color`.

Everything else in `lib/` imports `gi://` and cannot run under Node — but it is not limited to manual checking either. `test/headless/` boots an isolated `gnome-shell --headless` (private dbus, `GSETTINGS_BACKEND=memory`, its own `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_CONFIG_HOME`, a synthetic DB fixture) and drives it with probes covering search semantics, lifecycle, viewport windowing, cost, call-site wiring, the file permissions of what gets stored and what a `disable()` leaves behind:

```
./test/headless/run.sh all        # 3 configs x 13 probes = 39 sessions (~30s each)
```

It never opens the real `clipboard.db`, never writes the real dconf, and never changes the modes of anything under the maintainer's real `~/.cache` or `~/.config` -- `up.sh` asserts that separation and `run.sh` fails the whole batch if the real `~/.config/copyous@local` changed anyway. How to read its output, and which numbers are valid regression criteria, is in [MAINTENANCE.md](MAINTENANCE.md).

The settings window is a separate process, so `lib/preferences/**` is the one surface that can be verified *without logging out*: `test/prefs/run.sh` builds the real Adwaita widget tree under Xvfb (with `GSETTINGS_BACKEND=memory`, so no setting write reaches dconf) and asserts that every group has a title, every row that changes a setting carries a subtitle, every icon-only button carries a tooltip, and no two settings in one list share a title and subtitle.

```
./test/prefs/run.sh           # green / RED / NOT VERIFIED -- no logout needed
```

Every setting the schema declares has to have a way back to its default. `npm test` runs
`scripts/settings-coverage.mjs`, which cross-checks the 82 schema keys against the prefs sources and
fails four ways: a control with no reset button, a key name the schema does not declare, a reset for
a key it cannot find a control for, and a `bind` whose key is a variable -- that last shape cannot be
audited, so it is refused rather than skipped. Verdict on the last line: `RESULT: PASS`.

## 🆚 Changes vs upstream (2.0.1)

This fork adds commits on top of the upstream 2.0.1 baseline (`335fff2`), and the
baseline snapshot itself already carried fork changes (the `copyous@local` uuid, deferred
keybinding registration, dialog warmup with progressive reveal, and history pruning with
future-timestamp clamping). The count is deliberately not stated here — `git rev-list
--count 335fff2..HEAD` is authoritative and a hardcoded number always drifts.

The authoritative, per-commit divergence list — including what was deliberately **not**
changed and why — lives in [README.zh-CN.md](README.zh-CN.md#-相对上游的改动201). It is
maintained there only, so that the two files cannot drift apart. In brief:
The per-commit record — kind, evidence tier and commit for every divergence — is
[CHANGELOG.md](CHANGELOG.md), and `npm run check:log` proves that list covers every commit in the
declared window that touched production code. Division of labour, so this does not become a third
copy of the same facts: the curated narrative stays in `README.zh-CN.md` (single authoritative copy,
as stated above), CHANGELOG.md is the machine-checked index, and neither restates the other.


- **Security / correctness:** **parameterised all Gda queries** (removing string-built SQL), plus a broad correctness, performance and cleanup pass across 21 files.
- **Resource leaks:** destroy clipboard items when they are removed; release resources leaked on every enable/disable; discard async init work that outlives a disable; make the `actions.json` monitor guard consistent across both users; restore popup keyboard focus stolen by a modal grab and fix a `focusChild` typo; finish the close teardown when a shortcut press replaces the close animation's `onComplete`, which otherwise leaks `Main.modalCount` for the whole session; check the cancellation token before an async continuation writes through a `FileItem`/`LinkItem` actor that viewport recycling may already have destroyed.
- **Rendering scale / memory:** the freeze after boot or idle is not slow code but resident scale — 255 item trees (~5669 actors, 255 GLSL effects, ~105 MB always resident) inside a shell with ~900 MB swapped out, so opening the dialog is a major-fault storm. Search filtering moved off `actor.visible` onto the entry, the scroll container now treats the entry list as the source of truth with actors as a recyclable cache, and **actors are only built for the viewport ± one screen** when item size is uniform along the scroll axis. Measured A/B on the same data and settings: first-open TTI 423 → 65 ms, RSS after three open/close cycles 474 → 256 MB — at the cost of scrolling being ~13× more expensive per viewport crossed.
- **Performance:** memoize and debounce search; warm item style/Pango caches during startup fill; memoize `localeContains` and hoist the collator call; reduce startup file-existence scans; avoid duplicate code-item autodetection; cache action regexes; time dialog open; fix the common-directory walk; share one child `GSettings` per item type instead of one per item.
- **Database:** enable **WAL** with `synchronous=NORMAL` and `busy_timeout`; serialise history pruning; adaptive polling for Gda 5 statements; prune history only when an entry can actually be evicted.
- **i18n:** rename `.mo` files to match the gettext domain.
- **GNOME / GI compatibility:** pin the `Gtk`/`Gdk` imports to `?version=4.0` and `link.js`'s `Soup` import to `?version=3.0`.
- **Tests / tooling / docs:** unit suites for the four modules that load under plain Node, a headless harness that drives a real `gnome-shell --headless`, and the maintenance record that says how to read its output (`MAINTENANCE.md`, `AGENTS.md`). Assertion counts and probe results are stated once, in the ledger and in `MAINTENANCE.md`.
- **Deliberately unfixed:** the ledger also lists divergences that are left in place on purpose, each with the reason it is not worth touching — including where a fix was measured and *rejected*. Those entries are kept only in the Chinese section, so one decision cannot become two competing texts.

## 🤝 Contributing

Issues and pull requests are welcome. Please keep changes scoped and test them against the GNOME Shell versions listed above.

## 🙏 Credits & Attribution

This extension is a **maintenance fork** of **Copyous** by **boerdereinar**. All original design and features are their work.

- **Upstream:** [boerdereinar/copyous](https://github.com/boerdereinar/copyous) — license **GPL-3.0-or-later**
- **Upstream author:** boerdereinar
- **Fork baseline:** upstream **2.0.1** (commit `335fff2`)
- **Third-party:** [qrcodegen.js](https://github.com/nayuki/QR-Code-generator) by Project Nayuki — **MIT**
- **Prior art:** clipboard and keyboard handling patterns adapted from [Tudmotu/gnome-shell-extension-clipboard-indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator) (GPL); color-name data derived from [colorjs/color-name](https://github.com/colorjs/color-name).
- **Upstream lineage:** Copyous is a full rewrite of [Pano](https://github.com/oae/gnome-shell-pano).

## ⚖️ License

Licensed under the **GNU General Public License v3.0 or later** — see [LICENSE](LICENSE).

As a derivative work of Copyous, this fork remains under GPL-3.0-or-later and retains the upstream copyright notice.

© boerdereinar and contributors; fork modifications © SHADE-glitch.
