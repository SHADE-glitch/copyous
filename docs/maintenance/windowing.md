# Windowing: the gate, the knobs, and what turns it off silently

Viewport windowing is this repo's largest structural change, and the layer most easily disabled by accident. This section answers "after this change, is windowing still on?"

> **Origin**: section 6, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split);
> only the relative links were rewritten for the new directory level. This file is the sole owner of
> these facts; do not restate them elsewhere.


## 6. Windowing: the gate, the knobs, and what turns it off silently

`ClipboardScrollContainer._materialized()` narrows the window only when **item sizes are uniform on the scroll axis**:

```
windowable = orientation != VERTICAL || !dynamic-item-height
```

So:

- **`dynamic-item-height` is the actual windowing switch** (in the vertical case). Off → resident actors drop from 255 to 7–16;
  on → fully back to the old behaviour; both paths have probe coverage (`live` vs `unwindowed`).
- **`item-height` and `clipboard-size` are live knobs**; changing them **does not** need a logout:
  `updateSize()` listens for `changed::item-height`, and the container listens too, doing a `_syncWindow(true)` that
  recomputes the window and the spacer.
  If density is too low, lower `item-height` first (range 50–1000), or raise `clipboard-size` (dialog size).
  Windowed extent uses the current value, so it is exact at any `item-height`.
- ⚠ **The "Compact" preset in preferences sets `dynamic-item-height` back to `true`**
  (`lib/preferences/customization/profiles.js`), and the windowing gain **vanishes silently**.
  When investigating "why is it stuttering again", the first thing is `dconf read /org/gnome/shell/extensions/copyous/dynamic-item-height`.
- When the focused entry scrolls out of the window, key focus returns to the search box, but `_focusEntry` is kept — the
  next arrow key re-materializes it and scrolls back. The selected position is not lost; that is design, not a bug.
