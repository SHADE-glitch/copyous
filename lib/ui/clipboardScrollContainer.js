import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { registerClass } from '../common/gjs.js';
import { ClipboardItem } from './items/clipboardItem.js';
import { searchTextsFor } from './items/entrySearchTexts.js';
import { State, StatusItem } from './items/statusItem.js';
import { SearchChange } from './searchEntry.js';

var __decorate =
	(this && this.__decorate) ||
	function (decorators, target, key, desc) {
		var c = arguments.length,
			r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
			d;
		if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function')
			r = Reflect.decorate(decorators, target, key, desc);
		else
			for (var i = decorators.length - 1; i >= 0; i--)
				if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
		return (c > 3 && r && Object.defineProperty(target, key, r), r);
	};

let ClipboardScrollContainer = class ClipboardScrollContainer extends St.BoxLayout {
	_statusItem;
	_headSpacer;
	_tailSpacer;
	// The entry list is the source of truth; actors are a cache over a window of it.
	// `_entries` is in display order (datetime descending, ties by ascending id -- the
	// order the previous child-scanning insert produced), `_filtered` is the subsequence
	// passing the current query, and `_items` maps an entry to its actor when one exists.
	// Keeping the list separate from the actors is what allows the resident set to track
	// the viewport instead of history-length.
	_entries = [];
	_entrySet = new Set();
	_filtered = [];
	_items = new Map();
	_factory = null;
	// Per-entry search result. SearchQuery's incremental Same/LessStrict/MoreStrict rules
	// read the previous verdict back, so it has to be stored rather than derived from an
	// actor that may not exist.
	_filterState = new Map();
	_lastQuery = null;
	_focusEntry = null;
	_winLo = 0;
	_winHi = 0;
	_filteredGeneration = 0;
	_syncedGeneration = -1;
	// Destroying an item tears down its entry<->header property bindings, and releasing a
	// bidirectional binding can emit notify on the entry. Those handlers are entry-scoped
	// and would re-enter the sync that is doing the destroying, reading items that are
	// mid-dispose -- which GJS reports as "has been already disposed". Guard the teardown.
	_destroying = false;
	_syncing = false;
	_syncPending = false;
	_revealQueue = [];
	_revealerId = 0;
	_revealStart = 0;
	_revealSlices = 0;
	_revealTotal = 0;
	// Reveal cost split, all in µs of GLib.get_monotonic_time(). The elapsed
	// total alone cannot tell "8 shows cost 157ms" from "the idle source waited
	// 157ms for the main loop", and only the first is worth optimizing.
	_revealSetupUs = 0;
	_revealGapUs = 0;
	_revealWorkUs = 0;
	_revealPseudoUs = 0;
	_revealLastEnd = 0;

	constructor(ext) {
		super({
			style_class: 'clipboard-item-list',
			x_align: Clutter.ActorAlign.START,
			x_expand: false,
		});
		this._ext = ext;
		this._statusItem = new StatusItem(ext);
		// Stand-ins for the filtered entries outside the window, so the scroll range
		// stays the full list's. Hidden at zero size so they never take part in the
		// visible-child helpers or in focus navigation.
		this._headSpacer = new St.Widget({ reactive: false, can_focus: false, visible: false });
		this._tailSpacer = new St.Widget({ reactive: false, can_focus: false, visible: false });
		this._syncWindow(true);
	}

	setEntryFactory(factory) {
		this._factory = factory;
	}

	// --- entry list ---------------------------------------------------------------

	addEntry(entry) {
		if (this._entrySet.has(entry)) return;
		this._entrySet.add(entry);
		this._entries.splice(this._insertIndex(entry), 0, entry);
		entry.connectObject(
			// Move the entry when its datetime changes
			'notify::datetime',
			() => {
				if (!this._destroying) this._resortEntry(entry);
			},
			// Drop it when it is deleted or pruned
			'delete',
			() => {
				if (!this._destroying) this.removeEntry(entry);
			},
			// Re-filter it when its content is edited
			'notify::content',
			() => {
				if (!this._destroying) this._refilterEntry(entry);
			},
			this,
		);
		if (this._lastQuery) this._applyFilterEntry(entry, this._lastQuery);
		else this._filterState.set(entry, true);
		this._rebuildFiltered();
		// Materialize first: focusEntry() needs the actor to exist, and only the sync
		// decides whether this entry is inside the window that gets one.
		this._syncWindow(true);
		// Focus a newly copied entry when the dialog is open, so the selection
		// highlight follows it -- the behaviour addItem() had.
		if (this._ext.clipboardDialog?.opened) this.focusEntry(entry);
	}

	removeEntry(entry) {
		if (!this._entrySet.has(entry)) return;
		const item = this._items.get(entry);
		const hadFocus = item?.has_key_focus() ?? false;
		const index = this._filtered.indexOf(entry);
		// Disconnect before destroying: the item's teardown emits notify on the entry, and
		// a handler firing here would re-enter this method on a half-removed entry.
		entry.disconnectObject(this);
		this._entrySet.delete(entry);
		this._entries.splice(this._entries.indexOf(entry), 1);
		this._filterState.delete(entry);
		this._destroyItem(entry);
		if (this._focusEntry === entry) this._focusEntry = null;
		this._rebuildFiltered();
		this._syncWindow(true);
		if (hadFocus) {
			// Keep the selection where it was.
			const next = this._entryAtSlot(index);
			if (next) {
				this.focusEntry(next);
			} else {
				global.focus_manager.get_group(this).navigate_focus(this, St.DirectionType.UP, true);
			}
		}
	}

	clearItems() {
		const hadFocus = this._focusedEntry() !== null;
		this._cancelReveal();
		// Same discipline the previous implementation earned the hard way: disconnect and
		// unparent everything first, destroy last, so no read above touches a dead actor
		// and no binding teardown re-enters the list while it is being walked.
		const doomed = [...this._items.values()];
		for (const entry of this._entries) {
			entry.disconnectObject(this);
			this._items.delete(entry);
		}
		for (const item of doomed) {
			if (item.get_parent() === this) this.remove_child(item);
		}
		this._entries = [];
		this._entrySet.clear();
		this._filterState.clear();
		this._focusEntry = null;
		this._rebuildFiltered();
		this._syncWindow(true);
		if (hadFocus) {
			// Navigate to the search entry
			global.focus_manager.get_group(this).navigate_focus(this, St.DirectionType.UP, true);
		}
		// Unparenting is not enough: every item registered ~11 handlers on the
		// process-wide ext.settings object, and those closures pin the whole widget tree
		// for the rest of the session. GJS eventually finalizes such actors during a GC
		// sweep with the handlers still attached, which it reports as "Attempting to call
		// back into JSAPI during the sweeping phase of GC ... it would crash the
		// application". The destroy() overrides do the right cleanup.
		this._destroying = true;
		try {
			for (const item of doomed) item.destroy();
		} finally {
			this._destroying = false;
		}
	}

	// Display order: newest first, ties by ascending id.
	_before(a, b) {
		const c = a.datetime.compare(b.datetime);
		if (c !== 0) return c > 0;
		return a.id < b.id;
	}

	_insertIndex(entry) {
		let lo = 0;
		let hi = this._entries.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this._before(entry, this._entries[mid])) hi = mid;
			else lo = mid + 1;
		}
		return lo;
	}

	_resortEntry(entry) {
		const at = this._entries.indexOf(entry);
		if (at < 0) return;
		this._entries.splice(at, 1);
		this._entries.splice(this._insertIndex(entry), 0, entry);
		this._rebuildFiltered();
		this._syncWindow(true);
	}

	_refilterEntry(entry) {
		if (!this._lastQuery) return;
		const hadFocus = this._items.get(entry)?.has_key_focus() ?? false;
		const index = this._filtered.indexOf(entry);
		const matches = this._applyFilterEntry(entry, this._lastQuery);
		const item = this._items.get(entry);
		if (item) item.visible = matches;
		this._rebuildFiltered();
		this._syncWindow(true);
		// The entry just dropped out of _filtered, so _moveFocus() could not find it. Its
		// old slot now holds the entry that slid up -- the next match, which is where the
		// focus has to go to stay under the user's eye.
		if (hadFocus && !matches) {
			const next = this._entryAtSlot(index);
			if (next) this.focusEntry(next, false);
			// Navigate to the search entry
			else global.focus_manager.get_group(this).grab_key_focus();
		}
	}

	// The entry that occupies `index` now that the focused one is gone, else the one
	// before it. The pair reproduces the old next/previous-visible-sibling fallback.
	_entryAtSlot(index) {
		return this._filtered[index] ?? this._filtered[index - 1] ?? null;
	}

	_rebuildFiltered() {
		this._filtered = this._entries.filter((entry) => this._filterState.get(entry) ?? true);
		this._filteredGeneration++;
	}

	// --- filtering ------------------------------------------------------------------

	search(query) {
		// Copy search query, but with SearchChange.Different to always force re-search
		this._lastQuery = query.withChange(SearchChange.Different);
		const focused = this._focusedEntry();
		for (const entry of this._entries) this._applyFilterEntry(entry, query);
		this._rebuildFiltered();
		this._syncWindow(true);
		// _applyFilterEntry only writes the stored verdict; the actors have to be told
		// separately, and only here -- _materialize() must not override a reveal that is
		// deliberately holding items hidden.
		for (const [entry, item] of this._items) item.visible = this._filterState.get(entry) ?? true;
		this.removePseudoclasses();
		this.updatePseudoclasses();
		if (focused !== null && this._filterState.get(focused)) {
			this.focusEntry(focused, false);
		} else if (this._focusEntry !== null && this._filterState.get(this._focusEntry)) {
			this.scrollToEntry(this._focusEntry, false);
		} else if (this._filtered.length > 0) {
			this.focusEntry(this._filtered[0], false);
		}
	}

	// The only writer of an entry's match state, so it cannot drift from the actor's
	// visibility. `query.change` carries the incremental rules that read the previous
	// verdict back.
	_applyFilterEntry(entry, query) {
		const previous = this._filterState.get(entry) ?? true;
		const matches = query.matchesEntry(previous, entry, ...searchTextsFor(entry));
		this._filterState.set(entry, matches);
		return matches;
	}

	// --- materialization ------------------------------------------------------------

	// Which entries should have actors, as a half-open range of a list. Unwindowed, that
	// is every entry and the filter is carried by `visible` alone, so a keystroke never
	// destroys and rebuilds actors. Windowed, it is the slice of the *filtered* list near
	// the viewport -- which is the point: the resident set then tracks the viewport
	// instead of history-length.
	_materialized() {
		return { list: this._entries, lo: 0, hi: this._entries.length };
	}

	_syncWindow(force = false) {
		if (this._syncing) {
			this._syncPending = true;
			return;
		}
		this._syncing = true;
		try {
			this._syncWindowInner(force);
		} finally {
			this._syncing = false;
		}
		if (this._syncPending) {
			this._syncPending = false;
			this._syncWindow(true);
		}
	}

	_syncWindowInner(force) {
		const { list, lo, hi } = this._materialized();
		if (
			!force &&
			lo === this._winLo &&
			hi === this._winHi &&
			this._filteredGeneration === this._syncedGeneration
		)
			return;
		this._winLo = lo;
		this._winHi = hi;
		this._syncedGeneration = this._filteredGeneration;

		const wanted = new Set();
		for (let i = lo; i < hi; i++) wanted.add(list[i]);
		for (const entry of [...this._items.keys()]) {
			if (!wanted.has(entry)) this._destroyItem(entry);
		}

		const created = [];
		for (let i = lo; i < hi; i++) {
			const entry = list[i];
			if (!this._items.has(entry) && this._materialize(entry)) created.push(entry);
		}

		this.updateVisible();
		this._layoutChildren(list, lo, hi);
		this.removePseudoclasses();
		this.updatePseudoclasses();
		// Warm only after parenting: ensure_style() resolves against the parent chain, so
		// warming an unparented item builds a theme node that gets thrown away.
		for (const entry of created) this._items.get(entry)?.warmup?.();
	}

	_materialize(entry) {
		if (this._items.has(entry)) return true;
		if (!this._factory) return false;
		const item = this._factory(entry);
		if (!item) return false;
		this._items.set(entry, item);
		item.visible = this._filterState.get(entry) ?? true;
		return true;
	}

	_destroyItem(entry) {
		const item = this._items.get(entry);
		if (!item) return;
		this._items.delete(entry);
		// Drop our reference before destroying: a destroyed actor is only finalized once
		// nothing holds it, so leaving it in the reveal queue would pin the very widget
		// tree this is meant to release.
		const queued = this._revealQueue.indexOf(item);
		if (queued >= 0) this._revealQueue.splice(queued, 1);
		if (item.get_parent() === this) this.remove_child(item);
		this._destroying = true;
		try {
			item.destroy();
		} finally {
			this._destroying = false;
		}
	}

	// Sizes that make the scroll range equal the full filtered list's even though only
	// [lo, hi) is materialized. Each returns -1 when the spacer must be absent. Derived
	// from BoxLayout's own arithmetic (sum of children + spacing between them) so the
	// extent is exact rather than estimated; a spacer that is present costs one extra
	// gap, which the formulas absorb.
	_spacerSizes(n, lo, hi, extent, spacing) {
		const m = hi - lo;
		if (lo === 0 && hi >= n) return [-1, -1];
		if (lo === 0) return [-1, (n - hi) * extent + (n - hi - 1) * spacing];
		if (hi >= n) return [lo * extent + (lo - 1) * spacing, -1];
		return [lo * (extent + spacing) - spacing, (n - hi) * (extent + spacing) - spacing];
	}

	_setSpacerSize(spacer, px) {
		if (px < 0) {
			spacer.visible = false;
			return;
		}
		spacer.visible = px > 0;
		if (this.orientation === Clutter.Orientation.HORIZONTAL) {
			spacer.set_size(px, -1);
		} else {
			spacer.set_size(-1, px);
		}
	}

	_layoutChildren(list, lo, hi) {
		const n = list.length;
		const horizontal = this.orientation === Clutter.Orientation.HORIZONTAL;
		const spacing = this.get_layout_manager().spacing;
		const extent = horizontal
			? this._ext.settings.get_int('item-width')
			: this._ext.settings.get_int('item-height');
		const [head, tail] = this._spacerSizes(n, lo, hi, extent, spacing);
		this._setSpacerSize(this._headSpacer, head);
		this._setSpacerSize(this._tailSpacer, tail);

		const wanted = [];
		if (this._headSpacer.visible) wanted.push(this._headSpacer);
		for (let i = lo; i < hi; i++) {
			const item = this._items.get(list[i]);
			if (item) wanted.push(item);
		}
		if (this._tailSpacer.visible) wanted.push(this._tailSpacer);
		if (this._statusItem.get_parent() === this) wanted.push(this._statusItem);

		// set_child_at_index() reparents, so placing all N children on every add or
		// keystroke would cost N Clutter operations for a list that almost never moves.
		// Compare first; the steady state then costs N pointer comparisons.
		const current = this.get_children();
		if (current.length === wanted.length && current.every((child, i) => child === wanted[i])) return;

		let index = 0;
		for (const actor of wanted) {
			if (actor.get_parent() === this) this.set_child_at_index(actor, index);
			else this.insert_child_at_index(actor, index);
			index++;
		}
	}

	// --- status placeholder and pseudoclasses ---------------------------------------

	updateVisible() {
		if (this._filtered.length === 0) {
			if (this._statusItem.get_parent() !== this) this.add_child(this._statusItem);
			this.x_align = Clutter.ActorAlign.CENTER;
			this.x_expand = true;
			this._statusItem.state = this._entries.length === 0 ? State.Empty : State.NoResults;
		} else if (this._statusItem.get_parent() === this) {
			this.remove_child(this._statusItem);
			this.x_align = Clutter.ActorAlign.START;
			this.x_expand = false;
		}
	}

	// first-child/last-child belong to the ends of the *filtered list*, not to the ends
	// of the materialized window -- otherwise scrolling would restyle whichever item
	// happened to land at a window edge.
	_pseudoTargets() {
		if (this._filtered.length === 0) {
			const status = this._statusItem.get_parent() === this ? this._statusItem : null;
			return [status, status];
		}
		return [
			this._items.get(this._filtered[0]) ?? null,
			this._items.get(this._filtered[this._filtered.length - 1]) ?? null,
		];
	}

	removePseudoclasses() {
		for (const item of this._items.values()) {
			item.remove_style_pseudo_class('first-child');
			item.remove_style_pseudo_class('last-child');
		}
		this._statusItem.remove_style_pseudo_class('first-child');
		this._statusItem.remove_style_pseudo_class('last-child');
	}

	updatePseudoclasses() {
		const [first, last] = this._pseudoTargets();
		first?.add_style_pseudo_class('first-child');
		last?.add_style_pseudo_class('last-child');
	}

	// --- focus and scrolling --------------------------------------------------------

	_focusedEntry() {
		for (const [entry, item] of this._items) {
			if (item.has_key_focus()) return entry;
		}
		return null;
	}

	_entryOf(actor) {
		return actor instanceof ClipboardItem ? actor.entry : null;
	}

	focusEntry(entry, animate = true) {
		const item = this._items.get(entry);
		if (!item || item.get_parent() !== this) return;
		this._focusEntry = entry;
		item.grab_key_focus();
		this.scrollToChild(item, animate);
	}

	focusFirstFiltered(animate = true) {
		if (this._filtered.length > 0) this.focusEntry(this._filtered[0], animate);
	}

	focusLastFiltered(animate = true) {
		if (this._filtered.length > 0) this.focusEntry(this._filtered[this._filtered.length - 1], animate);
	}

	scrollToEntry(entry, animate = true) {
		const item = this._items.get(entry);
		if (item) this.scrollToChild(item, animate);
	}

	scrollToChild(child, animate = true) {
		if (child.get_parent() !== this) return;
		const box = child.get_allocation_box();
		let adjustment;
		let value;
		if (this.orientation === Clutter.Orientation.HORIZONTAL) {
			adjustment = this.hadjustment;
			value = box.x1 + box.get_width() * 0.5 - adjustment.page_size * 0.5;
		} else {
			adjustment = this.vadjustment;
			value = box.y1 + box.get_height() * 0.5 - adjustment.page_size * 0.5;
		}
		if (this.text_direction === Clutter.TextDirection.RTL) {
			value = adjustment.get_upper() - adjustment.page_size - value;
		}
		if (animate) {
			adjustment.ease(value, { duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
		} else {
			adjustment.value = value;
		}
	}

	// Moves focus by `delta` positions within the filtered list. At either end it falls
	// back to the opposite neighbour, which is what the old visible-sibling walk did.
	_moveFocus(entry, delta, animate = true) {
		const i = this._filtered.indexOf(entry);
		if (i < 0) return;
		const next = this._filtered[i + delta] ?? this._filtered[i - delta];
		if (next) {
			this.focusEntry(next, animate);
		} else {
			// Navigate to the search entry
			global.focus_manager.get_group(this).grab_key_focus();
		}
	}

	selectItem(index) {
		const entry = this._filtered[index];
		if (!entry) return false;
		this.focusEntry(entry);
		return true;
	}

	selectNextItem() {
		const focused = this._focusedEntry();
		if (focused !== null) {
			this._moveFocus(focused, 1);
			return;
		}
		this.focusFirstFiltered();
	}

	activateFirst() {
		// The first *match*, not the first visible child: the two differ once only part
		// of the filtered list has actors.
		const item = this._filtered.length > 0 ? this._items.get(this._filtered[0]) : null;
		if (item instanceof St.Button) {
			item.vfunc_clicked(1);
		}
	}

	// --- progressive reveal ---------------------------------------------------------

	_cancelReveal() {
		if (this._revealerId) {
			GLib.source_remove(this._revealerId);
			this._revealerId = 0;
		}
		this._revealQueue = [];
	}

	// Stop a running reveal and leave the tree in its final state. Unlike
	// _cancelReveal(), which serves the teardown paths and drops the queue, the
	// queued items are shown here: open() reveals only once per fill, so anything
	// left hidden would stay hidden for the rest of the session.
	cancelProgressiveReveal() {
		if (this._revealerId) {
			GLib.source_remove(this._revealerId);
			this._revealerId = 0;
		}
		if (this._revealQueue.length === 0) return;
		const queued = this._revealQueue;
		this._revealQueue = [];
		for (const child of queued) {
			// Skip actors detached by clear/remove; never resurrect items hidden by
			// an active search/filter.
			if (child.get_parent() !== this) continue;
			const entry = this._entryOf(child);
			if (entry !== null && this._lastQuery) this._applyFilterEntry(entry, this._lastQuery);
			child.visible = entry === null || (this._filterState.get(entry) ?? true);
		}
		this.removePseudoclasses();
		this.updatePseudoclasses();
	}

	// Progressively reveal items across idle slices so the first dialog
	// open after login doesn't map+paint all items in one blocking pass.
	// Only hides/shows; filtering stays owned by search().
	beginProgressiveReveal(keepFirst = 8, perSlice = 8) {
		// [Q1] clearEntries() 把 _progressiveDone 置回 false 后，若旧 revealer 仍在跑，
		// 直接返回会导致新条目不再隐藏、首开退化为全量绘制；取消旧队列后重跑。
		this._cancelReveal();
		const visible = [...this._items.values()].filter((item) => item.visible);
		if (visible.length <= keepFirst) return;
		this._revealQueue = visible.slice(keepFirst);
		this._revealStart = GLib.get_monotonic_time();
		this._revealSlices = 0;
		this._revealTotal = this._revealQueue.length;
		this._revealGapUs = 0;
		this._revealWorkUs = 0;
		this._revealPseudoUs = 0;
		for (const child of this._revealQueue) child.hide();
		this.removePseudoclasses();
		this.updatePseudoclasses();
		this._revealSetupUs = GLib.get_monotonic_time() - this._revealStart;
		this._revealLastEnd = GLib.get_monotonic_time();
		// DEFAULT_IDLE, not DEFAULT: the reveal slices must not compete with
		// input events and paint during the dialog open animation.
		this._revealerId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => this._revealSlice(perSlice));
	}

	_revealSlice(perSlice) {
		const entered = GLib.get_monotonic_time();
		this._revealGapUs += entered - this._revealLastEnd;
		let shown = 0;
		while (shown < perSlice && this._revealQueue.length > 0) {
			const child = this._revealQueue.shift();
			// Skip actors detached by clear/remove; never resurrect items hidden by
			// an active search/filter.
			if (child.get_parent() !== this) continue;
			const entry = this._entryOf(child);
			if (entry !== null && this._lastQuery) this._applyFilterEntry(entry, this._lastQuery);
			child.visible = entry === null || (this._filterState.get(entry) ?? true);
			shown++;
		}
		const workEnd = GLib.get_monotonic_time();
		this._revealWorkUs += workEnd - entered;
		this.removePseudoclasses();
		this.updatePseudoclasses();
		this._revealPseudoUs += GLib.get_monotonic_time() - workEnd;
		this._revealSlices++;
		this._revealLastEnd = GLib.get_monotonic_time();
		if (this._revealQueue.length === 0) {
			this._revealerId = 0;
			// The dialog's `idle after redraw` probe runs at PRIORITY_LOW(300), so
			// every one of these DEFAULT_IDLE(200) slices is guaranteed to land
			// inside that measurement window. Log them separately so the deferred
			// reveal cost can be told apart from the first map/allocate/paint.
			const ms = (us) => (us / 1000).toFixed(0);
			this._ext.logger?.log?.(
				`[timing] progressive reveal: ${this._revealTotal} items in ${this._revealSlices} slices, ` +
					`${ms(GLib.get_monotonic_time() - this._revealStart)}ms = ` +
					`work ${ms(this._revealWorkUs)} + gap ${ms(this._revealGapUs)} + ` +
					`pseudo ${ms(this._revealPseudoUs)} + setup ${ms(this._revealSetupUs)}`,
			);
			return GLib.SOURCE_REMOVE;
		}
		return GLib.SOURCE_CONTINUE;
	}

	// Read-only context for the `open(): show` timing: that number is paint-bound,
	// and per-item paint cost is set by content (Code lays out highlighted Pango
	// markup, Image decodes a pixbuf, long Text fills the item-height cap), so it
	// cannot be attributed without knowing what was on screen.
	// Wrapped so it can never break open(); a missing number beats a dead dialog.
	openProbeSummary(maxItems = 6) {
		try {
			const adjustment =
				this.orientation === Clutter.Orientation.HORIZONTAL ? this.hadjustment : this.vadjustment;
			const parts = [];
			for (const entry of this._filtered) {
				if (parts.length >= maxItems) break;
				parts.push(`${entry.type ?? '?'}:${entry.content?.length ?? 0}`);
			}
			return (
				`[timing] open(): page_size ${Math.round(adjustment?.page_size ?? 0)}px, ` +
				`${this._filtered.length} matching, ${this._items.size} materialized, top [${parts.join(' ')}]`
			);
		} catch (e) {
			return `[timing] open(): probe failed: ${e}`;
		}
	}

	destroy() {
		// The reveal idle keeps running on the main loop otherwise, holding a
		// reference to this container and its children.
		this._cancelReveal();
		const doomed = [...this._items.values()];
		for (const entry of this._entries) {
			entry.disconnectObject(this);
			this._items.delete(entry);
		}
		for (const item of doomed) {
			if (item.get_parent() === this) this.remove_child(item);
		}
		this._entries = [];
		this._entrySet.clear();
		this._filtered = [];
		this._filterState.clear();
		this._focusEntry = null;
		this._destroying = true;
		try {
			for (const item of doomed) item.destroy();
		} finally {
			this._destroying = false;
		}
		// Permanent children, so clearItems() deliberately leaves them alone. The C-side
		// cascade would skip the status item's JS destroy() and leak its settings handlers.
		this._statusItem?.destroy();
		this._headSpacer?.destroy();
		this._tailSpacer?.destroy();
		super.destroy();
	}

	vfunc_navigate_focus(from, direction) {
		const first = this._filtered[0] ?? null;
		const last = this._filtered.length > 0 ? this._filtered[this._filtered.length - 1] : null;
		const fromEntry = this._entryOf(from);

		// Navigation from the search entry
		if (from?.get_parent() !== this) {
			// If tab navigation is used, then focus on first or last child
			if (direction === St.DirectionType.TAB_FORWARD || direction === St.DirectionType.TAB_BACKWARD) {
				this._focusEntry = null;
				const entry = direction === St.DirectionType.TAB_BACKWARD ? last : first;
				if (entry !== null) this._focusEntry = entry;
			}

			// If the remembered focus is gone or filtered out, fall back to the first match
			if (
				this._focusEntry === null ||
				!this._filterState.get(this._focusEntry) ||
				!this._entrySet.has(this._focusEntry)
			) {
				this._focusEntry = first;
			}

			// Navigate to the search entry
			if (this._focusEntry === null) return Clutter.EVENT_PROPAGATE;
			this.focusEntry(this._focusEntry);
			return Clutter.EVENT_STOP;
		}

		if (fromEntry === null) return Clutter.EVENT_PROPAGATE;

		if (this.orientation === Clutter.Orientation.HORIZONTAL) {
			// If up or shift tab navigation then focus the search entry
			if (direction === St.DirectionType.UP) {
				this._focusEntry = fromEntry;

				// Navigate to the search entry
				return Clutter.EVENT_PROPAGATE;
			}

			// Ignore down navigation
			if (direction === St.DirectionType.DOWN) {
				return Clutter.EVENT_STOP;
			}
		} else {
			// If on the first child then focus the search entry
			if (fromEntry === first && direction === St.DirectionType.UP) {
				this._focusEntry = fromEntry;

				// Navigate to the search entry
				return Clutter.EVENT_PROPAGATE;
			}

			// If on the last child then focus on footer
			if (fromEntry === last && direction === St.DirectionType.DOWN) {
				this._focusEntry = fromEntry;
				return Clutter.EVENT_PROPAGATE;
			}

			// Ignore left and right navigation
			if (direction === St.DirectionType.LEFT || direction === St.DirectionType.RIGHT) {
				return Clutter.EVENT_STOP;
			}
		}

		// If on first child and shift tab navigation then focus the search entry
		if (fromEntry === first && direction === St.DirectionType.TAB_BACKWARD) {
			this._focusEntry = fromEntry;

			// Navigate to the search entry
			return Clutter.EVENT_PROPAGATE;
		}

		// If on last child and tab navigation then focus the footer
		if (fromEntry === last && direction === St.DirectionType.TAB_FORWARD) {
			this._focusEntry = fromEntry;

			// Navigate to footer
			return Clutter.EVENT_PROPAGATE;
		}

		// Index-based rather than super's sibling walk: the next filtered entry may not
		// have an actor yet, and only the list knows where it is.
		const delta =
			direction === St.DirectionType.TAB_FORWARD ||
			direction === St.DirectionType.RIGHT ||
			direction === St.DirectionType.DOWN
				? 1
				: -1;
		const i = this._filtered.indexOf(fromEntry);
		const next = this._filtered[i + delta];
		if (!next) return Clutter.EVENT_PROPAGATE;
		this.focusEntry(next);
		return Clutter.EVENT_STOP;
	}

	vfunc_map() {
		this._focusEntry = null;
		this.hadjustment.value = 0;
		this.vadjustment.value = 0;
		super.vfunc_map();
	}
};
ClipboardScrollContainer = __decorate([registerClass()], ClipboardScrollContainer);

export { ClipboardScrollContainer };
