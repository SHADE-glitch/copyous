import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/blob/89c57703641a9d5d15f899f6e780174641911d95/keyboard.js
export class Keyboard {
	_device;
	_purpose = Clutter.InputContentPurpose.NORMAL;

	constructor() {
		const seat = Clutter.get_default_backend().get_default_seat();
		this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
		Main.inputMethod.connectObject(
			'notify::content-purpose',
			(method) => {
				this._purpose = method.content_purpose;
			},
			this,
		);
	}

	destroy() {
		// Guarded: this runs from disable(), and a disconnect against an input
		// method that is already gone must not abort the rest of the teardown.
		try {
			Main.inputMethod.disconnectObject(this);
		} catch {
			// Input method already gone; the connection died with it.
		}
		this._device = null;
	}

	get purpose() {
		return this._purpose;
	}

	notify(keyval, state) {
		this._device?.notify_keyval(Clutter.get_current_event_time() * 1000, keyval, state);
	}

	press(keyval) {
		this.notify(keyval, Clutter.KeyState.PRESSED);
	}

	release(keyval) {
		this.notify(keyval, Clutter.KeyState.RELEASED);
	}
}
