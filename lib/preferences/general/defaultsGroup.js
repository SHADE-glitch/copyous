import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { registerClass } from '../../common/gjs.js';

var __decorate =
	(this && this.__decorate) ||
	function (decorators, target, key, desc) {
		var c = arguments.length,
			r =
				c < 3
					? target
					: desc === null
						? (desc = Object.getOwnPropertyDescriptor(target, key))
						: desc,
			d;
		if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function')
			r = Reflect.decorate(decorators, target, key, desc);
		else
			for (var i = decorators.length - 1; i >= 0; i--)
				if ((d = decorators[i]))
					r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
		return (c > 3 && r && Object.defineProperty(target, key, r), r);
	};

/**
 * One control that puts every key back to the value this fork ships, including the
 * child schemas (text/code/image/file/link/character items and the theme) that a
 * reset on the root schema alone would leave untouched. A reset cannot be undone,
 * so it asks first and reports back with a toast, the same two-step the dock's
 * preferences use.
 */
let DefaultsGroup = class DefaultsGroup extends Adw.PreferencesGroup {
	constructor(prefs, window) {
		super({
			title: _('Defaults'),
			description: _('The values this fork ships'),
		});

		const settings = prefs.getSettings();
		const row = new Adw.ActionRow({
			title: _('Restore default settings'),
			subtitle: _(
				'Resets every setting in this window, including the item and theme schemas. This cannot be undone.'
			),
		});
		const button = new Gtk.Button({
			label: _('Restore Defaults'),
			valign: Gtk.Align.CENTER,
			css_classes: ['destructive-action'],
		});
		button.connect('clicked', () => {
			const dialog = new Adw.AlertDialog({
				heading: _('Restore default settings?'),
				body: _(
					'Every setting returns to the value this fork ships: the clipboard layout, the search and history behaviour, the item and theme schemas, and the shortcuts. This cannot be undone.'
				),
			});
			dialog.add_response('cancel', _('Cancel'));
			dialog.add_response('restore', _('Restore Defaults'));
			dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);
			dialog.set_default_response('cancel');
			dialog.set_close_response('cancel');
			dialog.connect('response', (_dialog, response) => {
				if (response !== 'restore') return;
				DefaultsGroup.resetAll(settings);
				window.add_toast(new Adw.Toast({ title: _('Default settings restored'), timeout: 3 }));
			});
			dialog.present(window);
		});
		row.add_suffix(button);
		row.activatable_widget = button;
		this.add(row);
	}

	// A child schema is a separate Gio.Settings object, so resetting the root leaves
	// the per-item and theme keys alone; they are reset explicitly here.
	static resetAll(settings) {
		for (const key of settings.list_keys()) settings.reset(key);
		for (const name of settings.list_children()) {
			const child = settings.get_child(name);
			for (const key of child.list_keys()) child.reset(key);
		}
	}
};
DefaultsGroup = __decorate([registerClass()], DefaultsGroup);

export { DefaultsGroup };
