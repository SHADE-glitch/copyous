import Adw from 'gi://Adw';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { registerClass } from '../../common/gjs.js';
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

let NavigationShortcuts = class NavigationShortcuts extends Adw.PreferencesGroup {
	constructor() {
		super({
			title: _('Navigation'),
		});
		const navigate = new ShortcutRow(_('Navigate'), 'Tab Up Down Left Right');
		navigate.subtitle = _('Moves the focus between the search box, the filters and the items');
		this.add(navigate);
		const jumpToItem = new ShortcutRow(_('Jump to Item'), '<Ctrl>0...9');
		jumpToItem.subtitle = _('Selects an item by its place in the list; 0 is the tenth');
		this.add(jumpToItem);
		const jumpToStart = new ShortcutRow(_('Jump to Start'), 'Home');
		jumpToStart.subtitle = _('Selects the first item of the list');
		this.add(jumpToStart);
		const jumpToEnd = new ShortcutRow(_('Jump to End'), 'End');
		jumpToEnd.subtitle = _('Selects the last item of the list');
		this.add(jumpToEnd);
		const jumpToSearch = new ShortcutRow(_('Jump to Search'), '<Ctrl>F');
		jumpToSearch.subtitle = _('Puts the keyboard in the search box');
		this.add(jumpToSearch);
	}
};
NavigationShortcuts = __decorate([registerClass()], NavigationShortcuts);

export { NavigationShortcuts };
