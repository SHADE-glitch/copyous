<p align="right"><a href="README.md"><b>English</b></a> | <a href="README.zh-CN.md">简体中文</a></p>

# Copyous — Local Maintenance Fork

A modern clipboard manager for GNOME.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Based on: Copyous](https://img.shields.io/badge/based%20on-Copyous-orange)

## About

This repository is a **personal maintenance fork** of [**Copyous**](https://github.com/boerdereinar/copyous) by **boerdereinar**, frozen at upstream **2.0.1** and maintained locally under the UUID `copyous@local`.

It is **not** affiliated with or endorsed by the upstream author. The fork preserves the upstream feature set and focuses on **correctness, security, performance and resource management** — notably parameterising the SQLite queries, tuning the database, and eliminating leaks on enable/disable.

> Copyous itself is a full rewrite of the [Pano](https://github.com/oae/gnome-shell-pano) clipboard manager.

## Features

- **Clipboard history** for text, code, images, files, links, characters, colors and QR codes.
- **SQLite backend** via GNOME Data Access (Libgda 5 or 6), with JSON and in-memory alternatives.
- **Search** across history, plus **pinning**, **nine colored tags**, and an **incognito** mode.
- **Customizable actions** (`actions.json`) — run commands, open colors, generate QR codes.
- **Paste-on-copy**, primary-selection sync, and per-application (WM class) exclusions.
- **Theming** via GResource, optional **highlight.js** syntax highlighting, and **GSound** feedback.
- **D-Bus interface** (`org.gnome.Shell.Extensions.Copyous`) to show, hide, toggle and clear history.
- **82 GSettings keys** and **8 translations** (de, fr, it, pl, pt_BR, ru, tr, zh_CN).

## Prerequisites

| Requirement | Details |
|---|---|
| GNOME Shell | 48 – 50 |
| Libgda | Libgda 5.0 or 6.0 **with SQLite support** |
| GSound | Optional, for notification sounds |

```bash
# Fedora
sudo dnf install libgda libgda-sqlite gsound
# Arch Linux
sudo pacman -S libgda6 gsound
# Ubuntu / Debian
sudo apt install gir1.2-gda-5.0 gir1.2-gsound-1.0
# openSUSE
sudo zypper install libgda-6_0-sqlite typelib-1_0-Gda-6_0 typelib-1_0-GSound-1_0
```

## Installation

```bash
git clone <your-fork-url> ~/.local/share/gnome-shell/extensions/copyous@local
gnome-extensions enable copyous@local
```

On Wayland you must log out and back in for GNOME Shell to load the extension.

## Usage

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

## Preferences

Open **GNOME Settings → Extensions → Copyous → Settings** to configure the database backend and location, appearance and theming, indicator and dialog behavior, notification sounds, keyboard shortcuts, tags and actions.

## Changes vs upstream (2.0.1)

This fork adds 13 commits on top of the upstream 2.0.1 baseline (`335fff2`):

- **Security / correctness:** **parameterised all Gda queries** (removing string-built SQL), plus a broad correctness, performance and cleanup pass across 21 files.
- **Resource leaks:** release resources leaked on every enable/disable; discard async init work that outlives a disable; make the `actions.json` monitor guard consistent across both users; restore popup keyboard focus stolen by a modal grab and fix a `focusChild` typo.
- **Performance:** memoize `localeContains` and hoist the collator call; reduce startup file-existence scans; avoid duplicate code-item autodetection; cache action regexes; time dialog open; fix the common-directory walk.
- **Database:** enable **WAL** with `synchronous=NORMAL`; adaptive polling for Gda 5 statements; prune history only when an entry can actually be evicted.
- **i18n:** rename `.mo` files to match the gettext domain.

## Contributing

Issues and pull requests are welcome. Please keep changes scoped and test them against the GNOME Shell versions listed above.

## Credits & Attribution

This extension is a **maintenance fork** of **Copyous** by **boerdereinar**. All original design and features are their work.

- **Upstream:** [boerdereinar/copyous](https://github.com/boerdereinar/copyous) — license **GPL-3.0-or-later**
- **Upstream author:** boerdereinar
- **Fork baseline:** upstream **2.0.1** (commit `335fff2`)
- **Third-party:** [qrcodegen.js](https://github.com/nayuki/QR-Code-generator) by Project Nayuki — **MIT**
- **Prior art:** clipboard and keyboard handling patterns adapted from [Tudmotu/gnome-shell-extension-clipboard-indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator) (GPL); color-name data derived from [colorjs/color-name](https://github.com/colorjs/color-name).
- **Upstream lineage:** Copyous is a full rewrite of [Pano](https://github.com/oae/gnome-shell-pano).

## License

Licensed under the **GNU General Public License v3.0 or later** — see [LICENSE](LICENSE).

As a derivative work of Copyous, this fork remains under GPL-3.0-or-later and retains the upstream copyright notice.
