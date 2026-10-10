import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { ItemType } from '../common/constants.js';
import { registerClass } from '../common/gjs.js';
import { Icon, loadIcon } from '../common/icons.js';
import { normalizeIndentation, trim } from '../ui/components/label.js';
import { commonDirectory } from '../ui/items/filesItem.js';

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

let NotificationManager = class NotificationManager extends GObject.Object {
	ext;
	_source = null;

	constructor(ext) {
		super();
		this.ext = ext;
	}

	/**
	 * Decode a preview image in one pass and scale it for the notification.
	 *
	 * The old code paid for the file *twice*: `Pixbuf.get_file_info()` and
	 * `new_from_file_at_scale()` each open and inflate the whole PNG on the calling thread.
	 * Measured on the maintainer's own screenshots (1728x1056 / 2419x1478) that is 18-78ms
	 * plus 17-57ms, run straight from the clipboard `owner-changed` handler, so one image
	 * copy cost the compositor ~86-130ms -- probe 10 measured 86ms of blocked main loop.
	 * One full decode yields both the original dimensions and the preview, so this does that.
	 *
	 * It is still synchronous, deliberately: nothing in this process can spread a PNG decode.
	 * Feeding a `PixbufLoader` in 64KB slices with a yield between each measured 0.5-0.9ms per
	 * write but **62ms inside `close()`** (gdk-pixbuf's PNG path inflates at end-of-data, not
	 * incrementally), and `Pixbuf.new_from_stream_at_scale_async` blocks 32-50ms for the same
	 * reason. Removing the preview, or decoding in a subprocess, are the only ways below the
	 * single-decode cost -- recorded as a known unfixed item in `docs/maintenance/open-items.md`, and
	 * measured by `test/headless/probes/10-notification-loopgap.js`.
	 */
	preview(file, max = 256) {
		const full = GdkPixbuf.Pixbuf.new_from_file(file.get_path());
		const width = full.get_width();
		const height = full.get_height();
		const scale = Math.min(1, max / Math.max(width, height));
		return {
			width,
			height,
			pixbuf:
				scale === 1
					? full
					: full.scale_simple(
							Math.round(width * scale),
							Math.round(height * scale),
							GdkPixbuf.InterpType.BILINEAR,
						),
		};
	}

	get source() {
		if (this._source) return this._source;
		this._source = new MessageTray.Source({
			title: this.ext.metadata.name,
			icon: loadIcon(this.ext, Icon.Clipboard),
		});
		this._source.connect('destroy', () => (this._source = null));
		Main.messageTray.add(this._source);
		return this._source;
	}

	destroy() {
		// Destroying the source removes it from the message tray; the 'destroy'
		// handler above clears the field.
		this._source?.destroy();
	}

	warning(title, body, ...actions) {
		const source = this.source;
		const notification = new MessageTray.Notification({
			source,
			title,
			body,
			gicon: loadIcon(this.ext, Icon.Warning),
		});
		for (const [label, callback] of actions) {
			notification.addAction(label, callback);
		}
		source.addNotification(notification);
	}

	textNotification(text) {
		if (!this.ext.settings.get_boolean('send-notification')) return;
		const source = this.source;
		const notification = new MessageTray.Notification({
			source,
			title: _('Copied Text'),
			body: text,
			gicon: loadIcon(this.ext, Icon.Text),
			isTransient: true,
		});
		source.addNotification(notification);
	}

	createImageContent(pixbuf) {
		const context = global.stage.context.get_backend().get_cogl_context();
		const pixels = pixbuf.get_pixels();
		const content = new St.ImageContent({
			preferred_width: pixbuf.width,
			preferred_height: pixbuf.height,
		});
		// JPEG and other alpha-less sources are 3 bytes/pixel: feeding them to
		// RGBA_8888 with an RGB rowstride renders garbage. Match the format.
		const format = pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
		content.set_bytes(context, pixels, format, pixbuf.width, pixbuf.height, pixbuf.rowstride);
		return content;
	}

	imageNotification(bytes, width, height) {
		if (!this.ext.settings.get_boolean('send-notification')) return;
		let gicon;
		try {
			const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
			const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream, 256, 256, true, null);
			gicon = this.createImageContent(pixbuf);
		} catch (error) {
			this.ext.logger.error(error);
			return;
		}
		const source = this.source;
		const notification = new MessageTray.Notification({
			source,
			title: _('Copied Image'),
			body: _('Size: %d×%d px').format(width, height),
			gicon,
			isTransient: true,
		});
		source.addNotification(notification);
	}

	notification(entry) {
		if (!this.ext.settings.get_boolean('send-notification')) return;
		let title;
		let body = normalizeIndentation(trim(entry.content), 4);
		let gicon;
		switch (entry.type) {
			case ItemType.Text:
				title = _('Copied Text');
				gicon = loadIcon(this.ext, Icon.Text);
				break;
			case ItemType.Code:
				title = _('Copied Code');
				gicon = loadIcon(this.ext, Icon.Code);
				break;
			case ItemType.Image: {
				title = _('Copied Image');
				try {
					// `new_for_uri` rather than the old `body.substring('file://'.length)`:
					// the stored content is percent-encoded, so the raw tail was handed to
					// GdkPixbuf as a path and only ever worked for paths without escapes.
					const preview = this.preview(Gio.File.new_for_uri(body));
					gicon = this.createImageContent(preview.pixbuf);
					body = _('Size: %d×%d px').format(preview.width, preview.height);
				} catch (error) {
					this.ext.logger.error(error);
					return;
				}
				break;
			}
			case ItemType.File:
			case ItemType.Files: {
				const files = body.split('\n').map((f) => Gio.file_new_for_uri(f));
				const common = files.length === 1 ? files[0] : commonDirectory(files);
				title = ngettext('Copied %d File', 'Copied %d Files', files.length).format(files.length);
				body = common?.get_path() ?? '';
				gicon = loadIcon(this.ext, files.length === 1 ? Icon.File : Icon.Folder);
				break;
			}
			case ItemType.Link:
				title = _('Copied Link');
				gicon = loadIcon(this.ext, Icon.Link);
				break;
			case ItemType.Character:
				title = _('Copied Character');
				gicon = loadIcon(this.ext, Icon.Character);
				break;
		case ItemType.Color:
			title = _('Copied Color');
			gicon = loadIcon(this.ext, Icon.Color);
			break;
		default:
			return;
		}
		const source = this.source;
		const notification = new MessageTray.Notification({ source, title, body, gicon, isTransient: true });
		source.addNotification(notification);
	}
};
NotificationManager = __decorate([registerClass()], NotificationManager);

export { NotificationManager };
