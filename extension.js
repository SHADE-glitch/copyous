import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { getDataPath, getHljsLanguages, getHljsPath, makeStoredPrivate } from './lib/common/constants.js';
import { DbusService } from './lib/common/dbus.js';
import { migrateSettings } from './lib/common/settings.js';
import { tryCreateSoundManager } from './lib/common/sound.js';
import { ClipboardEntryTracker } from './lib/database/entryTracker.js';
import { ClipboardManager } from './lib/misc/clipboard.js';
import { NotificationManager } from './lib/misc/notifications.js';
import { ShortcutManager } from './lib/misc/shortcuts.js';
import { ThemeManager } from './lib/misc/theme.js';
import { ClipboardDialog } from './lib/ui/clipboardDialog.js';
import { ClipboardIndicator } from './lib/ui/indicator.js';

export default class CopyousExtension extends Extension {
	settings;
	logger;
	hljs;
	hljsMonitor;
	hljsLanguages;
	hljsCallbacks;
	themeManager;
	clipboardDialog;
	indicator;
	dbus;
	notificationManager;
	soundManager;
	shortcutsManager;
	entryTracker;
	historyTimeoutId = -1;
	updateHistory = false;
	clipboardManager;
	_initEntryTrackerRunning = false;
	_entryFillId = -1;
	_childSettings = null;
	// Bumped on every enable and disable. Async work started by _doEnable()
	// captures it and bails out if it no longer matches, so a disable that
	// lands while it is awaiting cannot leave resources behind.
	_enableGeneration = 0;

	enable() {
		// GDM autologin / suspend-resume hardening: defer the entire original
		// enable body to idle so Main.wm is ready to accept the global
		// Ctrl+Space keybinding. Without this, at boot/resume the shell may not
		// accept keybindings yet and the shortcut either registers late or never.
		this._enabled = true;
		this._deferredEnableId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
			this._deferredEnableId = null;
			if (!this._enabled)
				return GLib.SOURCE_REMOVE;
			try {
				this._doEnable();
			} catch (e) {
				this.logger?.error?.('deferred enable failed:', e);
			}
			return GLib.SOURCE_REMOVE;
		});
	}

	_doEnable() {
		const generation = ++this._enableGeneration;
		this.settings = this.getSettings();
		migrateSettings(this.settings);
		this.logger = this.getLogger();
		const error = this.logger.error.bind(this.logger);

		// History is stored verbatim, so anything already on disk is corrected before the
		// first write of this session. The catch is here because enable() must not depend on
		// a directory still being there mid-walk -- a lost chmod is logged, never fatal.
		try {
			makeStoredPrivate(this);
		} catch (err) {
			error(err);
		}

		// Highlight.js
		this.initHljs().catch(error);

		// Theme
		this.themeManager = new ThemeManager(this);

		// UI
		this.clipboardDialog = new ClipboardDialog(this);
		this.clipboardDialog.connectObject(
			'notify::opened',
			async () => {
				// Update the history when the dialog is closed and an update was scheduled while the dialog was open
				if (!this.clipboardDialog?.opened && this.updateHistory) {
					await this.entryTracker?.deleteOldest();
				}
			},
			'copy',
			async (_, entry) => {
				await this.clipboardManager?.copyEntry(entry);
				this.indicator?.showEntry(entry);
			},
			'paste',
			async (_, entry) => {
				await this.clipboardManager?.pasteEntry(entry);
				this.indicator?.showEntry(entry);
			},
			'clear-history',
			(_, history) => this.entryTracker?.clear(history),
			this,
		);
		this.indicator = new ClipboardIndicator(this);
		this.indicator.connectObject(
			'open-dialog',
			() => this.clipboardDialog?.open(),
			'clear-history',
			(_, history) => this.entryTracker?.clear(history),
			this,
		);

		// DBus
		this.dbus = new DbusService(this);
		this.dbus.connectObject(
			'toggle',
			() => this.clipboardDialog?.toggle(),
			'show',
			() => this.clipboardDialog?.open(),
			'hide',
			() => this.clipboardDialog?.close(),
			'clear-history',
			(_, history) => this.entryTracker?.clear(history === -1 ? null : history),
			this,
		);

		// Feedback
		this.notificationManager = new NotificationManager(this);
		tryCreateSoundManager(this)
			.then((soundManager) => {
				if (!soundManager) return;
				if (generation !== this._enableGeneration) {
					// Disabled while GSound was loading: keep nothing behind.
					soundManager.destroy();
					return;
				}
				this.soundManager = soundManager;
			})
			.catch(error);

		// Shortcuts
		this.shortcutsManager = new ShortcutManager(this, this.clipboardDialog);
		this.shortcutsManager.connectObject(
			'open-clipboard-dialog',
			() => this.clipboardDialog?.dialogShortcut(),
			'toggle-incognito-mode',
			() => this.indicator?.toggleIncognito(),
			this,
		);

		// Database
		this.entryTracker = new ClipboardEntryTracker(this);
		this.initEntryTracker().catch(error);
		this.initHistoryTimeout().catch(error);
		this.settings.connectObject(
			'changed::database-location',
			this.initEntryTracker.bind(this),
			'changed::database-backend',
			this.initEntryTracker.bind(this),
			'changed::history-time',
			this.initHistoryTimeout.bind(this),
			this,
		);

		// Clipboard Manager
		this.clipboardManager = new ClipboardManager(this, this.entryTracker);
		this.clipboardManager.connectObject(
			'clipboard',
			(_, entry) => {
				this.clipboardDialog?.registerEntry(entry);
				this.indicator?.showEntry(entry);
				this.indicator?.animate();
				this.notificationManager?.notification(entry);
				this.soundManager?.playSound();
			},
			'text',
			(_, text) => {
				this.indicator?.showText(text);
				this.indicator?.animate();
				this.notificationManager?.textNotification(text);
				this.soundManager?.playSound();
			},
			'image',
			(_, image, width, height) => {
				this.indicator?.showImageBytes(image);
				this.indicator?.animate();
				this.notificationManager?.imageNotification(image, width, height);
				this.soundManager?.playSound();
			},
			this,
		);
	}

	async initHljs() {
		if (this.hljs) return;
		const generation = this._enableGeneration;
		const hljsPath = getHljsPath(this);
		try {
			const hljs = await import(hljsPath.get_uri());
			if (generation !== this._enableGeneration) return;
			this.hljs = hljs.default;

			// Disable file monitor
			this.hljsMonitor?.cancel();
			this.hljsMonitor = undefined;

			// Initialize extra languages
			await this.loadHljsLanguages();
			if (generation !== this._enableGeneration) return;

			// Notify dependents
			this.hljsCallbacks?.forEach((fn) => fn());
			this.hljsCallbacks = undefined;
		} catch {
			if (generation !== this._enableGeneration) return;
			this.hljs = null;

			// Automatically load highlight.js
			if (!this.hljsMonitor) {
				this.hljsMonitor = hljsPath.monitor(Gio.FileMonitorFlags.NONE, null);
				this.hljsMonitor.connectObject(
					'changed',
					async (_monitor, _file, _otherFile, eventType) => {
						if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
							await this.initHljs();
						}
					},
					this,
				);
			}
		}
	}

	async loadHljsLanguages() {
		this.hljsLanguages ??= new Map();
		if (!this.hljsMonitor) {
			const path = getDataPath(this).get_child('languages');
			this.hljsMonitor = path.monitor_directory(Gio.FileMonitorFlags.NONE, null);
			this.hljsMonitor.connectObject(
				'changed',
				async (_monitor, _file, _otherFile, eventType) => {
					if (
						eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
						eventType === Gio.FileMonitorEvent.DELETED
					) {
						await this.loadHljsLanguages();
					}
				},
				this,
			);
		}
		const languages = getHljsLanguages(this);
		const path = getDataPath(this).get_child('languages');
		let languageFiles = null;
		try {
			languageFiles = new Set();
			const enumerator = path.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
			let info;
			while ((info = enumerator.next_file(null)) !== null) languageFiles.add(info.get_name());
			enumerator.close(null);
		} catch {
			// Keep the old per-file query fallback for an unavailable directory.
			languageFiles = null;
		}
		await Promise.all(
			languages.map(async ([name, _language, _hash, path, system]) => {
				const enabled = this.hljsLanguages?.get(name) ?? false;
				const exists =
					system || (languageFiles === null ? path.query_exists(null) : languageFiles.has(path.get_basename()));
				if (!exists) {
					if (enabled) {
						this.hljs?.unregisterLanguage(name);
						this.hljsLanguages?.set(name, false);
					}
					return;
				}
				if (enabled) return;
				try {
					const language = await import(path.get_uri());
					this.hljs?.registerLanguage(name, language.default);
					this.hljsLanguages?.set(name, true);
				} catch {
					// A disable during the import clears this.logger.
					this.logger?.error?.(`Failed to register language "${name}"`);
				}
			}),
		);
	}

	connectHljsInit(fn) {
		if (this.hljs != null) return () => {};
		this.hljsCallbacks ??= [];
		this.hljsCallbacks.push(fn);
		return () => {
			const index = this.hljsCallbacks?.indexOf(fn) ?? -1;
			if (index >= 0) this.hljsCallbacks.splice(index, 1);
		};
	}

	// One shared GSettings per child schema. Item constructors used to call
	// settings.get_child() per instance, so at history-length 250 the session held
	// up to 255 extra GSettings objects, each with its own dconf watch; clipboard.js
	// built two more throwaways on every single copy.
	childSettings(name) {
		this._childSettings ??= new Map();
		let child = this._childSettings.get(name);
		if (!child) {
			child = this.settings.get_child(name);
			this._childSettings.set(name, child);
		}
		return child;
	}

	_cancelEntryFill() {
		if (this._entryFillId >= 0) {
			GLib.source_remove(this._entryFillId);
			this._entryFillId = -1;
		}
	}

	async initEntryTracker() {
		// A re-trigger while a previous fill is still slicing must not let the
		// stale slices re-add entries into the freshly cleared dialog.
		this._cancelEntryFill();
		if (this._initEntryTrackerRunning) return;
		this._initEntryTrackerRunning = true;
		const generation = this._enableGeneration;
		try {
			if (!this.entryTracker || !this.entryTracker.shouldInit) return;
			this.clipboardDialog?.clearEntries();
			const loadStart = GLib.get_monotonic_time();
			const entries = await this.entryTracker.init();
			if (generation !== this._enableGeneration) return;
			this.logger?.log?.(
				`[timing] loaded ${entries.length} entries in ${(GLib.get_monotonic_time() - loadStart) / 1000}ms`,
			);
			// Add entries in idle slices instead of one synchronous burst, so a
			// keybinding press right after login never queues behind ~70 item
			// constructions on the main loop.
			const fillStart = GLib.get_monotonic_time();
			let index = 0;
			const perSlice = 8;
			const fillSlice = () => {
				this._entryFillId = -1;
				if (generation !== this._enableGeneration) return GLib.SOURCE_REMOVE;
				const end = Math.min(index + perSlice, entries.length);
				for (; index < end; index++) {
					// ~8 entries per slice keeps any one callback short. The container
					// decides which of them get an actor, and warms the ones it builds.
					this.clipboardDialog?.registerEntry(entries[index]);
				}
				if (index >= entries.length) {
					this.logger?.log?.(
						`[timing] filled ${entries.length} entries in ${(GLib.get_monotonic_time() - fillStart) / 1000}ms`,
					);
					// Warm up dialog caches while idle so the first open() after
					// login doesn't pay cold-start costs under the modal grab.
					const warmupStart = GLib.get_monotonic_time();
					this.clipboardDialog?.warmup();
					this.logger?.log?.(
						`[timing] warmup took ${(GLib.get_monotonic_time() - warmupStart) / 1000}ms`,
					);
					return GLib.SOURCE_REMOVE;
				}
				this._entryFillId = GLib.idle_add(GLib.PRIORITY_DEFAULT, fillSlice);
				return GLib.SOURCE_REMOVE;
			};
			this._entryFillId = GLib.idle_add(GLib.PRIORITY_DEFAULT, fillSlice);
		} finally {
			// If a newer generation took over, it owns the flag now.
			if (generation === this._enableGeneration) this._initEntryTrackerRunning = false;
		}
	}

	async initHistoryTimeout() {
		const generation = this._enableGeneration;
		if (this.historyTimeoutId >= 0) {
			GLib.source_remove(this.historyTimeoutId);
			this.historyTimeoutId = -1;
		}
		const historyTime = this.settings?.get_int('history-time');
		if (historyTime === undefined || historyTime === 0) return;
		await this.entryTracker?.deleteOldest();
		// A disable during the await already removed the old timer; adding a new
		// one now would leave a timer running on a disabled extension.
		if (generation !== this._enableGeneration) return;
		// A second changed::history-time during the await installs its own timer and
		// overwrites the id, so re-check before assigning: an id that is overwritten
		// here could never be removed again and would keep firing every 60s.
		if (this.historyTimeoutId >= 0) {
			GLib.source_remove(this.historyTimeoutId);
			this.historyTimeoutId = -1;
		}
		this.historyTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
			// Do not update the history if the dialog is open
			this.updateHistory = this.clipboardDialog?.opened ?? false;
			if (this.updateHistory) return GLib.SOURCE_CONTINUE;
			if (this.entryTracker?.checkOldest()) {
				this.entryTracker?.deleteOldest().catch(this.logger.error.bind(this.logger));
			}
			return GLib.SOURCE_CONTINUE;
		});
	}

	disable() {
		if (this._deferredEnableId !== null) {
			try { GLib.Source.remove(this._deferredEnableId); } catch (e) {}
			this._deferredEnableId = null;
		}
		if (!this._enabled)
			return;
		this._enabled = false;
		this._doDisable();
	}

	_doDisable() {
		// Invalidate async work still in flight from _doEnable(): it must not
		// touch the state that is about to be torn down, and it must not create
		// monitors, timers or stylesheets that nothing would ever clean up.
		this._enableGeneration++;
		// The new generation has to be able to start its own init.
		this._initEntryTrackerRunning = false;
		this._cancelEntryFill();

		// UI
		this.clipboardDialog?.disconnectObject(this);
		this.clipboardDialog?.destroy();
		this.indicator?.disconnectObject(this);
		this.indicator?.destroy();
		this.clipboardDialog = undefined;
		this.indicator = undefined;

		// Highlight.js
		this.hljs = undefined;
		this.hljsMonitor?.disconnectObject(this);
		this.hljsMonitor?.cancel();
		this.hljsMonitor = undefined;
		this.hljsLanguages = undefined;
		this.hljsCallbacks = undefined;

		// Theme
		this.themeManager?.destroy();
		this.themeManager = undefined;

		// DBus
		this.dbus?.disconnectObject(this);
		this.dbus?.destroy();
		this.dbus = undefined;

		// Feedback
		this.notificationManager?.destroy();
		this.notificationManager = undefined;
		this.soundManager?.destroy();
		this.soundManager = undefined;

		// Shortcuts
		this.shortcutsManager?.disconnectObject(this);
		this.shortcutsManager?.destroy();
		this.shortcutsManager = undefined;

		// Database
		const error = this.logger?.error?.bind(this.logger) ?? console.error;
		this.entryTracker?.destroy().catch(error);
		this.entryTracker = undefined;
		if (this.historyTimeoutId >= 0) GLib.source_remove(this.historyTimeoutId);
		this.historyTimeoutId = -1;

		// Clipboard Manager
		this.clipboardManager?.disconnectObject(this);
		this.clipboardManager?.destroy();
		this.clipboardManager = undefined;

		// Globals
		this.settings?.disconnectObject(this);
		this.settings = undefined;
		this._childSettings = undefined;
		this.logger = undefined;
	}
}
