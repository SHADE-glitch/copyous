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

let PopupMenuShortcuts = class PopupMenuShortcuts extends Adw.PreferencesGroup {
	constructor() {
		super({ title: _('Filter Menu') });
		const selectTag = new ShortcutRow(_('Select Item Tag'), '0...9');
		// Documentation only: these digits are hardcoded in the filter menu, and there is no
		// settings key behind them. The item type is not a shortcut at all but a mnemonic --
		// saying so here is what stops the row reading as "0-9 should select a type".
		selectTag.subtitle = _('0 clears the tag, 1 to 9 pick one by colour, and the underlined letter picks the type');
		this.add(selectTag);
	}
};
PopupMenuShortcuts = __decorate([registerClass()], PopupMenuShortcuts);

export { PopupMenuShortcuts };
