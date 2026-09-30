import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { registerClass } from '../common/gjs.js';
import {
	get_first_visible_child,
	get_last_visible_child,
	get_n_visible_children,
	get_next_visible_sibling,
	get_previous_visible_sibling,
} from '../misc/actor.js';
import { ClipboardItem } from './items/clipboardItem.js';
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
	_lastFocus = null;
	_lastQuery = null;
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
		this.updateVisible();
	}

	updateVisible() {
		const n = get_n_visible_children(this);
		if (n === 0) {
			this.add_child(this._statusItem);
			this.x_align = Clutter.ActorAlign.CENTER;
			this.x_expand = true;
			if (this.get_n_children() === 1) {
				this._statusItem.state = State.Empty;
			} else {
				this._statusItem.state = State.NoResults;
			}
		} else if (n >= 2 && this._statusItem.get_parent() !== null) {
			this.remove_child(this._statusItem);
			this.x_align = Clutter.ActorAlign.START;
			this.x_expand = false;
		}
		this.updatePseudoclasses();
	}

	removePseudoclasses() {
		get_first_visible_child(this)?.remove_style_pseudo_class('first-child');
		get_last_visible_child(this)?.remove_style_pseudo_class('last-child');
	}

	updatePseudoclasses() {
		get_first_visible_child(this)?.add_style_pseudo_class('first-child');
		get_last_visible_child(this)?.add_style_pseudo_class('last-child');
	}

	nextFocus(child, animate = true) {
		if (child.get_parent() !== this) return;
		const newFocus = get_next_visible_sibling(child) ?? get_previous_visible_sibling(child);
		if (newFocus && newFocus !== this._statusItem) {
			this.focusChild(newFocus, animate);
		} else {
			// Navigate to the search entry
			global.focus_manager.get_group(this).grab_key_focus();
		}
	}

	focusChild(child, animate = true) {
		if (child.get_parent() !== this) return;
		this._lastFocus = child;
		child.grab_key_focus();
		this.scrollToChild(child, animate);
	}

	scrollToFocus(animate = true) {
		for (const child of this.get_children()) {
			if (child.has_key_focus()) {
				this._lastFocus = child;
				this.scrollToChild(child, animate);
				return;
			}
		}
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

	addItem(item) {
		this.insertOrMoveItem(item);
		if (this._lastQuery) {
			item.search(this._lastQuery);
		}

		// Focus new item if dialog is open so selection highlight follows
		if (this._ext.clipboardDialog?.opened && item.get_parent() === this) {
			// [S1] focus_child 不存在于 St（St-18 typelib 取证确认），原调用抛 TypeError
			// 并中断其后的 datetime/delete/content 信号连接；类内方法名为 focusChild。
			this.focusChild(item);
		}

		// Move item when datetime changes
		item.entry.connectObject('notify::datetime', () => this.insertOrMoveItem(item), this);

		// Delete item when deleted
		item.entry.connectObject('delete', () => this.removeItem(item), this);

		// Update search when entry content changes
		item.entry.connectObject('notify::content', () => this.updateSearch(item), this);
	}

	insertOrMoveItem(item) {
		this.removePseudoclasses();
		if (item.get_parent() === this) this.remove_child(item);
		let i = 0;
		for (const c of this.get_children()) {
			if (c instanceof ClipboardItem && (c.entry.datetime.compare(item.entry.datetime) < 0 || (c.entry.datetime.compare(item.entry.datetime) === 0 && c.entry.id < item.entry.id))) {
				this.insert_child_at_index(item, i);
				break;
			}
			i++;
		}
		if (i === this.get_n_children()) {
			this.add_child(item);
		}
		this.updateSearch(item);
		this.updateVisible();
	}

	clearItems() {
		let focus = false;
		const removed = [];
		for (const child of this.get_children()) {
			if (child instanceof ClipboardItem) {
				focus ||= child.has_key_focus();
				child.entry.disconnectObject(this);
				this.remove_child(child);
				removed.push(child);
			}
		}
		// Every queued reveal target is gone now, and _lastFocus would otherwise
		// keep pinning a widget tree that is about to be released.
		this._cancelReveal();
		this._lastFocus = null;
		this.updateVisible();
		if (focus) {
			// Navigate to the search entry
			global.focus_manager.get_group(this).navigate_focus(this, St.DirectionType.UP, true);
		}
		// Unparenting is not enough: every item registered ~11 handlers on the
		// process-wide ext.settings object (see ClipboardItem's constructor), and
		// those closures pin the whole widget tree for the rest of the session.
		// GJS eventually finalizes the actors during a GC sweep with the handlers
		// still attached, which it reports as "Attempting to call back into JSAPI
		// during the sweeping phase of GC ... it would crash the application".
		// The destroy() overrides already do the right cleanup; they were simply
		// never called. Destroying last keeps every read above on live actors.
		for (const child of removed) child.destroy();
	}

	removeItem(child) {
		if (child.get_parent() !== this) return;
		child.entry.disconnectObject(this);
		const hasKeyFocus = child.has_key_focus();
		let newFocus = null;
		if (hasKeyFocus) {
			newFocus = get_next_visible_sibling(child) ?? get_previous_visible_sibling(child);
		}
		this.remove_child(child);
		// Drop our own references before destroying: a destroyed actor is only
		// finalized once nothing holds it, so leaving it in _revealQueue or in
		// _lastFocus would pin the very widget tree this is meant to release.
		const queued = this._revealQueue.indexOf(child);
		if (queued >= 0) this._revealQueue.splice(queued, 1);
		if (this._lastFocus === child) this._lastFocus = null;
		this.updateVisible();
		if (hasKeyFocus) {
			if (newFocus && newFocus !== this._statusItem) {
				this.focusChild(newFocus);
			} else {
				this._lastFocus = null;

				// Navigate to the search entry
				global.focus_manager.get_group(this).navigate_focus(this, St.DirectionType.UP, true);
			}
		}
		// Last, so nothing above can touch the actor after it is gone.
		child.destroy();
	}

	selectItem(index) {
		let i = 0;
		for (const child of this.get_children()) {
			if (child instanceof ClipboardItem && child.visible) {
				if (i === index) {
					this.focusChild(child);
					return true;
				}
				i++;
			}
		}
		return false;
	}

	selectNextItem() {
		let focusChild = null;
		for (const child of this.get_children()) {
			if (focusChild === null && child instanceof ClipboardItem && child.visible) {
				focusChild = child;
			}
			if (child.has_key_focus()) {
				this.nextFocus(child);
				return;
			}
		}
		if (focusChild !== null) {
			this.focusChild(focusChild);
		}
	}

	search(query) {
		// Copy search query, but with SearchChange.Different to always force re-search
		this._lastQuery = query.withChange(SearchChange.Different);
		this.removePseudoclasses();
		let focusChild = null;
		let firstVisible = null;
		for (const child of this.get_children()) {
			if (child instanceof ClipboardItem) {
				const hasFocus = child.has_key_focus();
				child.search(query);
				if (hasFocus) focusChild = child;
				if (child.visible && firstVisible === null) firstVisible = child;
			}
		}
		this.updateVisible();
		if (focusChild && focusChild.visible) {
			this.focusChild(focusChild, false);
		} else if (this._lastFocus && this._lastFocus.visible) {
			this.scrollToChild(this._lastFocus, false);
		} else if (firstVisible !== null) {
			this.focusChild(firstVisible, false);
		}
	}

	updateSearch(item) {
		if (!this._lastQuery) return;
		const hasKeyFocus = item.has_key_focus();
		this.removePseudoclasses();
		item.search(this._lastQuery);
		this.updateVisible();
		if (hasKeyFocus && !item.visible) this.nextFocus(item, false);
	}

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
			if (this._lastQuery) child.search(this._lastQuery);
			else child.show();
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
		const visible = this.get_children().filter(
			(child) => child instanceof ClipboardItem && child.visible,
		);
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
			// Skip actors detached by clear/remove; never resurrect
			// items hidden by an active search/filter.
			if (child.get_parent() !== this) continue;
			if (this._lastQuery) child.search(this._lastQuery);
			else child.show();
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
	// Model-based on purpose. Deriving the viewport from children's
	// get_allocation_box() would need allocation semantics here that have never
	// been measured in this fork; entry.type/content.length are authoritative and
	// this costs one property read per visible child.
	// Wrapped so it can never break open(); a missing number beats a dead dialog.
	openProbeSummary(maxItems = 6) {
		try {
			const adjustment =
				this.orientation === Clutter.Orientation.HORIZONTAL ? this.hadjustment : this.vadjustment;
			const parts = [];
			let visible = 0;
			for (const child of this.get_children()) {
				if (!(child instanceof ClipboardItem) || !child.visible) continue;
				visible++;
				if (parts.length < maxItems) {
					parts.push(`${child.entry?.type ?? '?'}:${child.entry?.content?.length ?? 0}`);
				}
			}
			return (
				`[timing] open(): page_size ${Math.round(adjustment?.page_size ?? 0)}px, ` +
				`${visible} visible, top [${parts.join(' ')}]`
			);
		} catch (e) {
			return `[timing] open(): probe failed: ${e}`;
		}
	}

	destroy() {
		// The reveal idle keeps running on the main loop otherwise, holding a
		// reference to this container and its children.
		this._cancelReveal();
		// Permanent child, so clearItems() deliberately leaves it alone. The C-side
		// cascade would skip its JS destroy() and leak its settings handlers.
		this._statusItem?.destroy();
		super.destroy();
	}

	activateFirst() {
		const first = get_first_visible_child(this);
		if (first instanceof St.Button) {
			first.vfunc_clicked(1);
		}
	}

	vfunc_navigate_focus(from, direction) {
		// Navigation from the search entry
		if (from?.get_parent() !== this) {
			// If tab navigation is used, then focus on first or last child
			if (direction === St.DirectionType.TAB_FORWARD || direction === St.DirectionType.TAB_BACKWARD) {
				this._lastFocus = null;
				const child =
					direction === St.DirectionType.TAB_BACKWARD
						? get_last_visible_child(this)
						: get_first_visible_child(this);
				if (child !== this._statusItem) {
					this._lastFocus = child;
				}
			}

			// If the last focus is null or not visible, then focus the first visible child
			if (this._lastFocus === null || !this._lastFocus.visible || this._lastFocus.get_parent() !== this) {
				this._lastFocus = null;
				const child = get_first_visible_child(this);
				if (child !== this._statusItem) {
					this._lastFocus = child;
				}
			}

			// Navigate to the search entry
			if (!this._lastFocus) return Clutter.EVENT_PROPAGATE;
			this._lastFocus.grab_key_focus();
			this.scrollToChild(this._lastFocus);
			return Clutter.EVENT_STOP;
		}
		const first = get_first_visible_child(this);
		const last = get_last_visible_child(this);
		if (this.orientation === Clutter.Orientation.HORIZONTAL) {
			// If up or shift tab navigation then focus the search entry
			if (direction === St.DirectionType.UP) {
				this._lastFocus = from;

				// Navigate to the search entry
				return Clutter.EVENT_PROPAGATE;
			}

			// Ignore down navigation
			if (direction === St.DirectionType.DOWN) {
				return Clutter.EVENT_STOP;
			}
		} else {
			// If on the first child then focus the search entry
			if (from === first && direction === St.DirectionType.UP) {
				this._lastFocus = from;

				// Navigate to the search entry
				return Clutter.EVENT_PROPAGATE;
			}

			// If on the last child then focus on footer
			if (from === last && direction === St.DirectionType.DOWN) {
				this._lastFocus = from;
				return Clutter.EVENT_PROPAGATE;
			}

			// Ignore left and right navigation
			if (direction === St.DirectionType.LEFT || direction === St.DirectionType.RIGHT) {
				return Clutter.EVENT_STOP;
			}
		}

		// If on first child and shift tab navigation then focus the search entry
		if (from === first && direction === St.DirectionType.TAB_BACKWARD) {
			this._lastFocus = from;

			// Navigate to the search entry
			return Clutter.EVENT_PROPAGATE;
		}

		// If on last child and tab navigation then focus the footer
		if (from === last && direction === St.DirectionType.TAB_FORWARD) {
			this._lastFocus = from;

			// Navigate to footer
			return Clutter.EVENT_PROPAGATE;
		}

		// Otherwise map navigation to tab navigation due to weird behavior for a larger number of items
		const tabDirection =
			direction === St.DirectionType.TAB_FORWARD ||
			direction === St.DirectionType.RIGHT ||
			direction === St.DirectionType.DOWN
				? St.DirectionType.TAB_FORWARD
				: St.DirectionType.TAB_BACKWARD;
		const res = super.vfunc_navigate_focus(from, tabDirection);
		this.scrollToFocus();
		return res;
	}

	vfunc_map() {
		this._lastFocus = null;
		this.hadjustment.value = 0;
		this.vadjustment.value = 0;
		super.vfunc_map();
	}
};
ClipboardScrollContainer = __decorate([registerClass()], ClipboardScrollContainer);

export { ClipboardScrollContainer };
