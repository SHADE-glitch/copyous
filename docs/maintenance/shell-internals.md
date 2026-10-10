# Our dependence on Shell internals

Every dependence on shell private anything is gathered here: the ABI library needed to copy an implementation, the deliberately committed gresource build artifacts, and **every place a shell private symbol is used** (which file, which symbol, why it cannot be avoided, the symptom on upgrade).

> **Origin**: items 2 and 4 of section 8, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split);
> the dependency inventory below was run live by `scripts/shell-internals.mjs` on 2026-10-09 and then had the judgement columns added.
> This file is the sole owner of these facts; do not restate them elsewhere.

## 1. Two hard facts

1. ABI library name: on GNOME 50 it is `libshell-18.so` (not `libgnome-shell.so`). To copy a shell implementation, use
   `gresource extract /usr/lib/gnome-shell/libshell-18.so /org/gnome/shell/ui/<file>.js`.

2. `theme.gresource` and `resources.gresource` are **build artifacts, deliberately committed** (this repo has no build step),
   and **there is no CSS source in the repo**. Any visual change amounts to introducing a build chain — which is not allowed.
   Readable but not editable: `gresource list theme.gresource` → `gresource extract theme.gresource <path>`
   (the subcommand is `extract`; there is no `show`).

## 2. How to regenerate the inventory

The inventory's **symbol column must not be hand-copied**: it is a property of the code and goes stale the moment a line changes. Re-run:

```sh
node scripts/shell-internals.mjs          # prints the first three columns of the table below + totals
```

The script does only the mechanical part: it pulls `resource:///org/gnome/shell/**` imports from the source, pulls this repo's call sites of the symbols those modules export, pulls `global.*` and `Meta.*` / `Shell.*`, then aggregates "which files use it" per symbol.
It also guards one criterion along the way (end of section 3), exiting 2 on red.
The **why it cannot be avoided / upgrade symptom / status** columns are judgements, not in the script's output; the person changing the code fills them in by hand,
and must do so against the referenced party's real definition in the shell source — filling those three columns from memory is forgery.

The script's granularity is `module.member` (`Main.layoutManager` counts as one row); the table below is finer, because
`layoutManager`'s five uses are of completely different risk levels — that is the point of the judgement column, not two tables.

## 3. Inventory (measured on this machine 2026-10-09)

Scale (the last four lines of `node scripts/shell-internals.mjs`, verbatim): **52 shell-side files scanned**,
**17 private modules** (14 of them `resource:///org/gnome/shell/**`, the other 3 being `global`, `gi://Shell`,
`gi://Meta` — they are typelibs, but their ABI follows the shell's major version), **46 private symbols**,
**29 files with private dependencies**.

Three of those rows are not "fragile dependencies": the `Extension`, `_`, `ngettext` exported by `extensions/extension.js` are the style given in the official
docs (`_` covers 16 files, `ngettext` 4), of a completely different risk order from something like `Main.layoutManager`, and are listed here only so the total adds up.

| Symbol | Used in | Why it cannot be avoided | Symptom on upgrade | Status |
| --- | --- | --- | --- | --- |
| `extensions/extension.js` → `Extension` | `extension.js` | Base class; without it this is not an extension | Only breaks when a major changes the constructor signature, and breaks loudly | Verified on 50.1 here |
| `ui/main.js` → `Main.layoutManager.modalDialogGroup` | `lib/ui/clipboardDialog.js` | The extension's own full-screen dialog must be mounted into the shell's compositor layer; the public alternative (`ModalDialog`) grabs global modality, and we do not want its modality | Container renamed ⇒ `add_child` of undefined ⇒ enable throws on the spot, not silently | Verified on 50.1 here |
| `ui/main.js` → `Main.layoutManager.uiGroup` | `editDialog.js`, `clipboardItemMenu.js`, `searchEntry.js` | As above: the mount point for the three kinds of overlay | As above | Verified on 50.1 here |
| `ui/main.js` → `Main.layoutManager.dummyCursor` | `clipboardItemMenu.js` | A `PopupMenu` constructor must be given an anchor actor, and the entry menu follows the mouse, with no real actor | `dummyCursor` gone ⇒ menu construction fails; the whole entry menu stops working | Verified on 50.1 here |
| `Main.layoutManager.setDummyCursorGeometry()` | `clipboardDialog.js` | Lets the mouse-following overlay still have a position to compute after the pointer is `grab`bed | Method renamed ⇒ TypeError, blows up when opening the dialog | Verified on 50.1 here |
| `Main.layoutManager.emit('system-modal-opened')` | `clipboardDialog.js` | We `pushModal` ourselves, but other parts of the shell (panel, other extensions) use this signal to yield; not emitting it means fighting other extensions for keys | **The most fragile one**: a renamed signal does not error, it just silently stops working ⇒ shows up as "after opening the dialog, some shortcuts get eaten by the panel" | Needs manual confirmation (see item 5) |
| `Main.pushModal / popModal` | `clipboardDialog.js` | The only entry point for keyboard/mouse exclusivity | A changed return type is a silent bug: 45→49 return a `Grab` object, earlier return a seat value. We branch on `VERSION` already | Verified on 50.1 here |
| `Main.inputMethod` (`connectObject`/`disconnectObject`, `cursor-location-changed`) | `clipboardDialog.js`, `lib/misc/keyboard.js` | The edit box must follow the input method's candidate window, and only this signal gives the cursor position | Signal renamed ⇒ candidate window misplaced when typing Chinese/Japanese, no error | Verified on 50.1 here |
| `misc/ibusManager.js` → `getIBusManager()` | `clipboardDialog.js` | As above; you need the ibus handle to read surrounding text | Function gone ⇒ enable throws, loudly | Verified on 50.1 here |
| `Main.wm.addKeybinding / removeKeybinding` | `lib/misc/shortcuts.js` | GNOME's keybinding registration must be done by the shell's WM; grabbing keys directly is illegal on Wayland | Signature change ⇒ shortcuts silently not registered; at enable time Main.wm may not be ready, so our enable body yields one idle round first | Verified on 50.1 here |
| `Main.panel` | `lib/ui/indicator.js` | The status icon must be added to the panel | `panel` refactored (e.g. quick-settings-ised) ⇒ icon mispositioned or gone | Verified on 50.1 here |
| `Main.messageTray` | `lib/misc/notifications.js` | We want a **custom Source** (with a button, able to "turn off this kind of prompt"); a DBus notification cannot do it | Tray refactor ⇒ notification does not appear or the Source duplicates | Verified on 50.1 here |
| `Main.getStyleVariant()` | `lib/misc/theme.js` | Decides dark or light stylesheet; `gtk-application-prefer-dark-theme` is not enough to cover accent/contrast combinations | Return shape changes ⇒ wrong theme, interface changes look but does not crash | Verified on 50.1 here |
| `ui/popupMenu.js` (`PopupMenu`, `PopupMenuSection`, `PopupMenuManager`, `PopupBaseMenuItem`, `PopupMenuItem`, `PopupSeparatorMenuItem`, `PopupSubMenuMenuItem`, `PopupSwitchMenuItem`, `Ornament`) | 7 files | The widget body of every entry menu, search dropdown, and tag menu | This family is the most stable (nearly every third-party extension uses it); if it breaks, the whole tree of menus throws on the spot | Verified on 50.1 here |
| `ui/boxpointer.js` → `BoxPointer.PopupAnimation` | 4 files | The overlay's expand animation enum | Enum member renamed ⇒ animation param becomes undefined, showing as the overlay not fading in | Verified on 50.1 here |
| `ui/modalDialog.js` → `ModalDialog` | 3 files | The base class for the edit/QR/confirm dialogs | Same family | Verified on 50.1 here |
| `ui/dialog.js` → `Dialog.MessageDialogContent` | 3 files | Only its content area is wanted, not the whole window | Class renamed ⇒ construction throws | Verified on 50.1 here |
| `ui/layout.js` → `Layout.MonitorConstraint` | `clipboardDialog.js` | Makes the dialog follow the monitor the cursor is on | Enum renamed ⇒ pops onto the wrong screen with multiple monitors | Verified on 50.1 here |
| `ui/messageTray.js` → `Source`, `Notification` | `lib/misc/notifications.js` | See above | Constructor signature changes ⇒ notification path throws | Verified on 50.1 here |
| `ui/panelMenu.js` → `Button` | `lib/ui/indicator.js` | Panel icon base class | Same family | Verified on 50.1 here |
| `ui/checkBox.js` → `CheckBox` | `lib/ui/indicator.js` | The check row in the panel menu; `Switch` does not look right | Class gone ⇒ panel menu construction throws | Verified on 50.1 here |
| `misc/animationUtils.js` → `wiggle()` | `lib/ui/indicator.js` | Shake feedback on a shortcut conflict | Function renamed ⇒ no feedback, silent | Verified on 50.1 here |
| `misc/dateUtils.js` → `formatTimeSpan()` | `lib/ui/items/clipboardItemHeader.js` | The timestamp must follow the locale; building it by hand would hard-code the format | Renamed ⇒ the entry header throws on the spot | Verified on 50.1 here |
| `misc/config.js` → `PACKAGE_VERSION` | `lib/misc/compatibility.js` | The only version-probing entry point; the branching in item 4 below all depends on it | Field name changes ⇒ enable throws | Verified on 50.1 here |
| `global.compositor` (`disable_unredirect`/`enable_unredirect`) | `clipboardDialog.js` | Without turning unredirect off, the first frame on opening the dialog gets stale screen content (measured as a flash) | Method renamed ⇒ TypeError; not calling them in pairs ⇒ permanent compositor performance degradation, **and this pairing is watched by probe 02** | Verified on 50.1 here |
| `global.focus_manager` | `clipboardDialog.js`, `clipboardScrollContainer.js`, `tagsItem.js` | Tab/arrow movement in the windowed list can only go through its `add_tabgroup`/`get_focus_child` | Semantics change ⇒ focus goes off-screen | Verified on 50.1 here |
| `global.display` | `clipboardDialog.js`, `editDialog.js`, `lib/misc/clipboard.js` | Keycodes, monitors, and seat-related things all live here | Same family | Verified on 50.1 here |
| `global.stage` | `lib/misc/theme.js`, `notifications.js` | `St.ThemeContext.get_for_stage(global.stage)` is the only way to get the current theme | Same family | Verified on 50.1 here |
| `global.workspace_manager` | `clipboardDialog.js` | The dialog follows the current workspace | It was renamed once back in the 40 era; another change means a throw | Verified on 50.1 here |
| `global.get_pointer()` | `clipboardItem.js`, `clipboardDialog.js` | The click position decides the menu anchor | Same family | Verified on 50.1 here |
| `Meta.later_add` | `clipboardDialog.js` | Wait until the shell has really composited this frame before timing/measuring; `idle` cannot do it (it fires before the redraw) | `Meta.LaterType` semantics change ⇒ first-frame numbers distorted, functionality unaffected | Verified on 50.1 here |
| `Meta.SelectionSource`, `Meta.SelectionType` | `lib/misc/clipboard.js` | Reading/writing the primary selection on Wayland must carry a source marker | Enum changes ⇒ copy silently fails | Verified on 50.1 here |
| `Meta.KeyBindingFlags`, `Meta.accelerator_name`, `Meta.Cursor` | `lib/misc/shortcuts.js`, `editDialog.js` | Shortcut registration and a custom cursor | Same family | Verified on 50.1 here |
| `gi://Shell` → `Shell.ActionMode` (`SYSTEM_MODAL`, `ALL`) | `clipboardDialog.js`, `lib/misc/shortcuts.js` | The scope of modality and shortcuts | Enum changes ⇒ modal behaviour becomes entirely wrong | Verified on 50.1 here |
| `gi://Shell` → `Shell.GLSLEffect` (subclassing + `registerClass`) | `lib/ui/items/clipboardItem.js` | The entry content area must "route around" the header button, punching a hole, which needs a custom shader. `Shell.GLSLEffect` is the only GLSL-effect base class the shell exposes to extensions, and `get_uniform_location` / `set_uniform_float` / `vfunc_build_pipeline` / `vfunc_paint_target` all come from it, along with `Graphene.Point3D` and `apply_relative_transform_to_point()` | **The highest-risk visual dependency**: the base class renamed or the uniform-passing method changed ⇒ every entry throws on construction; a shader compile failure ⇒ only one line of cogl warning, the animation silently disappearing (nothing in the CSS references this effect, so a break leaves no style trace) | Verified on 50.1 here (all three headless arms build these entries every run) |

## 4. The four places already branched by version

These are where this repo **has already paid the upgrade cost**, and the reason `Config.PACKAGE_VERSION` above exists:

| Location | Condition | Difference |
| --- | --- | --- |
| `lib/ui/clipboardDialog.js:463` | `VERSION >= 50` | grab-failure test: 50 uses `grab.is_revoked()`, 49 and below use `grab.get_seat_state() !== Clutter.GrabState.ALL` |
| `lib/ui/clipboardDialog.js:504` | `VERSION >= 49` | open animation: from 49 uses `EASE_OUT_QUAD` + 0.96 scale |
| `lib/ui/clipboardDialog.js:571` | `VERSION >= 49` | close animation: as above |
| `lib/ui/indicator.js:127` | `VERSION < 50` returns directly | the panel icon's right-click gesture menu is a 50-only API |

## 5. Why there is no "centralised isolation"

AGENTS.md requires "isolate private shell API dependencies centrally when they must be depended on". **The current state does not do this, and it is not caused by this change**:
these 32 symbols are a fait accompli from upstream 2.0.1, scattered across 9 UI/misc files, and pulling them into a `lib/shell/` facade
would be "refactoring for a metric you cannot see" (no pain evidence), and would also split the calls in `clipboardDialog.js` that are coupled to animation and
timing across two files — which is harder to read.

So the alternative here is **the inventory itself**: on upgrade, run `node scripts/shell-internals.mjs` first, diff the old and new outputs, and
a symbol disappearing (rather than being renamed) can still be found; column 4 lists the symptom, used to decide which log to read.
**New** private dependencies are still required to be centralised: put them in `lib/misc/compatibility.js` or a sibling module right next to it; do not open a new
file just to get one private symbol.

## 6. The prefs-side path

All 33 files under `lib/preferences/**` import
`resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` only to get `gettext as _`.
It is the style given in GNOME's official extension docs (capital `Shell`, the `/Extensions/js/` prefix, a different set of paths from the shell side's lowercase
`resource:///org/gnome/shell/...`), so it counts as a "blessed private path", and its upgrade risk surface is
of a completely different order from the 32 symbols above. It also does not run in the shell process — see [verification.md](verification.md)'s
L0b: all of `lib/preferences/**` is verified by `test/prefs/run.sh` building the whole tree for real under Xvfb, with no logout needed.
