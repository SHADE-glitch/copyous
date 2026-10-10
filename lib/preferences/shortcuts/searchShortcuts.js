import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { registerClass } from '../../common/gjs.js';
import { makeResettable } from '../utils.js';
import { ShortcutRow } from './shortcutRow.js';

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

const ShortcutLabel = ('ShortcutLabel' in Gtk && !('ShortcutLabel' in Adw) ? Gtk : Adw).ShortcutLabel;
let ScrollShortcutRow = class ScrollShortcutRow extends Adw.ActionRow {
	_ctrlLabel;

	constructor(title, showCtrl) {
		super({ title });
		const box = new Gtk.Box();
		this.add_suffix(box);
		this._ctrlLabel = new ShortcutLabel({ accelerator: '<Ctrl>&', valign: Gtk.Align.CENTER, visible: showCtrl });
		box.append(this._ctrlLabel);
		const scrollLabel = new Gtk.Box({ css_name: 'shortcut-label', valign: Gtk.Align.CENTER });
		box.append(scrollLabel);
		const scrollKeycap = new Gtk.Label({ css_classes: ['keycap'], label: _('Scroll') });
		scrollLabel.append(scrollKeycap);
	}

	get showCtrl() {
		return this._ctrlLabel.visible;
	}

	set showCtrl(value) {
		this._ctrlLabel.visible = value;
	}
};
ScrollShortcutRow = __decorate(
	[
		registerClass({
			Properties: {
				'show-ctrl': GObject.ParamSpec.boolean('show-ctrl', null, null, GObject.ParamFlags.READWRITE, true),
			},
		}),
	],
	ScrollShortcutRow,
);
let SearchShortcuts = class SearchShortcuts extends Adw.PreferencesGroup {
	constructor() {
		super({ title: _('Search') });
		const pinnedSearch = new ShortcutRow(_('Toggle Pinned Search'), '<Alt>');
		pinnedSearch.subtitle = _('Show only pinned items, or the whole history again');
		this.add(pinnedSearch);
		const clearFilter = new ShortcutRow(_('Clear Item Tag/Type'), 'Back');
		clearFilter.subtitle = _('With an empty search box, drops both the tag and the type filter');
		this.add(clearFilter);
		const activateFirst = new ShortcutRow(_('Activate First Item'), 'Return');
		activateFirst.subtitle = _('Runs the top result, so it pastes unless the copy shortcut is swapped');
		this.add(activateFirst);
	}
};
SearchShortcuts = __decorate([registerClass()], SearchShortcuts);

export { SearchShortcuts };

let SearchNavigationShortcuts = class SearchNavigationShortcuts extends Adw.PreferencesGroup {
	constructor() {
		super({ title: _('Search Filters') });
		const nextType = new ShortcutRow(_('Next Item Type'), '<Ctrl>Tab');
		nextType.subtitle = _('Step the type filter: text, code, image, file, files, link, character, color');
		this.add(nextType);
		const prevType = new ShortcutRow(_('Previous Item Type'), '<Ctrl><Shift>Tab');
		prevType.subtitle = _('Step the type filter backwards');
		this.add(prevType);
		const nextTag = new ShortcutRow(_('Next Item Tag'), '<Ctrl>grave');
		nextTag.subtitle = _('Step the tag filter through the nine tag colours');
		this.add(nextTag);
		const prevTag = new ShortcutRow(_('Previous Item Tag'), '<Ctrl><Shift>grave');
		prevTag.subtitle = _('Step the tag filter backwards');
		this.add(prevTag);
		const selectTag = new ShortcutRow(_('Select Item Tag'), '<Ctrl><Shift>0...9');
		selectTag.subtitle = _('Pick a tag by number, 0 for no tag');
		this.add(selectTag);
	}
};
SearchNavigationShortcuts = __decorate([registerClass()], SearchNavigationShortcuts);

export { SearchNavigationShortcuts };

let SearchScrollShortcuts = class SearchScrollShortcuts extends Adw.PreferencesGroup {
	constructor(prefs) {
		super({ title: _('Search Scrolling') });
		const swapScrollRow = new Adw.SwitchRow({
			title: _('Swap Scroll Shortcut'),
			subtitle: _('Swaps scroll shortcuts of cycling item types and item tags'),
		});
		this.add(swapScrollRow);
		const cycleItemTypeRow = new ScrollShortcutRow(_('Cycle Item Type'), swapScrollRow.active);
		cycleItemTypeRow.subtitle = _('Scroll over the dialog to step the type filter');
		this.add(cycleItemTypeRow);
		const cycleItemTagRow = new ScrollShortcutRow(_('Cycle Item Tag'), !swapScrollRow.active);
		cycleItemTagRow.subtitle = _('Scroll over the dialog to step the tag filter');
		this.add(cycleItemTagRow);

		// Bind properties
		swapScrollRow.bind_property('active', cycleItemTypeRow, 'show-ctrl', GObject.BindingFlags.DEFAULT);
		swapScrollRow.bind_property('active', cycleItemTagRow, 'show-ctrl', GObject.BindingFlags.INVERT_BOOLEAN);
		const settings = prefs.getSettings();
		settings.bind('swap-scroll-shortcut', swapScrollRow, 'active', null);
		makeResettable(swapScrollRow, settings, 'swap-scroll-shortcut');
	}
};
SearchScrollShortcuts = __decorate([registerClass()], SearchScrollShortcuts);

export { SearchScrollShortcuts };
