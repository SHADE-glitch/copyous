import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { registerClass } from '../../common/gjs.js';
import { bind_enum } from '../../common/settings.js';
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

let ItemShortcuts = class ItemShortcuts extends Adw.PreferencesGroup {
	constructor(prefs) {
		super({
			title: _('Item'),
		});
		const pinItem = new ShortcutRow(_('Pin Item'), '', true);
		pinItem.subtitle = _('Keeps the item when history is trimmed to its limit');
		this.add(pinItem);
		const deleteItem = new ShortcutRow(_('Delete Item'), 'Delete', true);
		deleteItem.subtitle = _('Holding shift force deletes');
		this.add(deleteItem);
		const editItem = new ShortcutRow(_('Edit Item'), '', true);
		editItem.subtitle = _('Only supported for text and code items');
		this.add(editItem);
		const editTitle = new ShortcutRow(_('Edit Title'), '', true);
		editTitle.subtitle = _('Give the item a heading of its own instead of its content');
		this.add(editTitle);
		const openMenu = new ShortcutRow(_('Open Menu'), '', true);
		openMenu.subtitle = _('List the actions available for the selected item');
		this.add(openMenu);
		const middleClickAction = new Adw.ComboRow({
			title: _('Middle Click Action'),
			subtitle: _('What pressing the middle mouse button on an item does'),
			model: Gtk.StringList.new([_('None'), _('Pin Item'), _('Delete Item')]),
		});
		this.add(middleClickAction);

		// Bind properties
		const settings = prefs.getSettings();
		settings.bind('pin-item-shortcut', pinItem, 'shortcuts', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('delete-item-shortcut', deleteItem, 'shortcuts', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('edit-item-shortcut', editItem, 'shortcuts', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('edit-title-shortcut', editTitle, 'shortcuts', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('open-menu-shortcut', openMenu, 'shortcuts', Gio.SettingsBindFlags.DEFAULT);
		bind_enum(settings, 'middle-click-action', middleClickAction, 'selected');
		makeResettable(pinItem, settings, 'pin-item-shortcut');
		makeResettable(deleteItem, settings, 'delete-item-shortcut');
		makeResettable(editItem, settings, 'edit-item-shortcut');
		makeResettable(editTitle, settings, 'edit-title-shortcut');
		makeResettable(openMenu, settings, 'open-menu-shortcut');
		makeResettable(middleClickAction, settings, 'middle-click-action');
	}
};
ItemShortcuts = __decorate([registerClass()], ItemShortcuts);

export { ItemShortcuts };

let ItemActivationShortcuts = class ItemActivationShortcuts extends Adw.PreferencesGroup {
	constructor(prefs) {
		super({
			title: _('Item Activation'),
		});
		const swapCopyPasteRow = new Adw.SwitchRow({
			title: _('Swap Copy Shortcut'),
			subtitle: _('Swap copy and paste shortcuts'),
		});
		this.add(swapCopyPasteRow);
		const pasteRow = new ShortcutRow(_('Paste Item'), 'Return space');
		pasteRow.subtitle = _('Copy the item, paste it into the app in focus, then close the dialog');
		this.add(pasteRow);
		const copyRow = new ShortcutRow(_('Copy Item'), '<Shift>Return space');
		copyRow.subtitle = _('Put the item on the clipboard and leave the dialog open');
		this.add(copyRow);
		const defaultActionRow = new ShortcutRow(_('Activate Default Action'), '<Ctrl>Return space');
		defaultActionRow.subtitle = _('Run the default action assigned to the item type on the Actions page');
		this.add(defaultActionRow);
		swapCopyPasteRow.connect('notify::active', () => {
			if (swapCopyPasteRow.active) {
				pasteRow.shortcuts = ['<Shift>Return space'];
				copyRow.shortcuts = ['Return space'];
			} else {
				pasteRow.shortcuts = ['Return space'];
				copyRow.shortcuts = ['<Shift>Return space'];
			}
		});
		const settings = prefs.getSettings();
		settings.bind('swap-copy-shortcut', swapCopyPasteRow, 'active', null);
		makeResettable(swapCopyPasteRow, settings, 'swap-copy-shortcut');
	}
};
ItemActivationShortcuts = __decorate([registerClass()], ItemActivationShortcuts);

export { ItemActivationShortcuts };
