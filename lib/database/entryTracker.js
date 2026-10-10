import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ItemType, getDefaultDatabaseFile } from '../common/constants.js';
import { DatabaseBackend } from '../common/settings.js';
import { getLinkImagePath } from '../misc/link.js';
import { GdaDatabase } from './gda.js';
import { JsonDatabase } from './json.js';
import { MemoryDatabase } from './memory.js';

export class ClipboardEntryTracker {
	ext;
	_database;
	_entries = new Map();
	_fromDefault = false;
	_destroyed = false;
	_insertPromise = Promise.resolve();
	_deleteOldestPromise = Promise.resolve();

	constructor(ext) {
		this.ext = ext;
	}

	get shouldInit() {
		if (this._fromDefault) {
			this._fromDefault = false;
			return false;
		}
		return true;
	}

	async init() {
		if (this._database) {
			await this.clear();
			await this.destroy();
		}
		// Re-armed after the re-init teardown above: from here on, a disable() that
		// lands mid-init must abort the backend this call is about to open.
		this._destroyed = false;
		const backend = this.ext.settings.get_enum('database-backend');
		const file = this.getFile();
		const dir = file.get_parent();
		const fileName = file.get_basename().replace(/(\.db|\.json)$/, '');
		const dbFile = dir.get_child(`${fileName}.db`);
		const jsonFile = dir.get_child(`${fileName}.json`);

		// Default database strategy is as followed:
		// 1. (memory)  in-memory-database (deprecated) set to true
		// 2. (sqlite)  .db file exists
		// 3. (json)    .json file exists
		// 4. (sqlite)  sqlite backend can be loaded
		// 5. (json)    json backend can be loaded
		// 6. fallback to in-memory
		let entries = null;
		if (backend === DatabaseBackend.Default) {
			this._fromDefault = true;
			if (this.ext.settings.get_boolean('in-memory-database')) {
				this.ext.logger.log('Set default database backend to in-memory');
				entries = await this.initMemory();
			} else if (dbFile.query_exists(null)) {
				entries = await this.initSqlite(dbFile, true);
				this.ext.settings.set_enum('database-backend', DatabaseBackend.Sqlite);
				this.ext.logger.log('Set default database backend to SQLite');
			} else if (jsonFile.query_exists(null)) {
				entries = await this.initJson(jsonFile);
				this.ext.settings.set_enum('database-backend', DatabaseBackend.Json);
				this.ext.logger.log('Set default database backend to JSON');
			} else {
				entries = await this.initSqlite(dbFile, false);
				if (entries !== null) {
					this.ext.settings.set_enum('database-backend', DatabaseBackend.Sqlite);
					this.ext.logger.log('Set default database backend to SQLite');
				} else {
					entries = await this.initJson(jsonFile);
					if (entries !== null) {
						this.ext.settings.set_enum('database-backend', DatabaseBackend.Json);
						this.ext.logger.log('Set default database backend to JSON');
					} else {
						entries = await this.initMemory();
						this.ext.settings.set_enum('database-backend', DatabaseBackend.Memory);
						this.ext.logger.log('Set default database backend to in-memory');
					}
				}
			}
		} else if (backend === DatabaseBackend.Sqlite) {
			entries = await this.initSqlite(dbFile, true);
		} else if (backend === DatabaseBackend.Json) {
			entries = await this.initJson(jsonFile);
		}

		// Fallback to in-memory
		entries ??= await this.initMemory();

		// A disable() landed while the backend was opening. The extension has
		// already dropped its reference to this tracker, so its destroy() ran
		// against a still-undefined _database and nothing would ever close the
		// connection opened above. Close it here and stop before tracking.
		if (this._destroyed) {
			await this._database?.close();
			this._database = undefined;
			return [];
		}

		// Filter out corrupted entries (empty content for file-based types)
		const validEntries = entries.filter((entry) => {
			if (!entry.content && [ItemType.File, ItemType.Files, ItemType.Image].includes(entry.type)) {
				this.ext.logger.warn(`Skipping corrupted entry: id=${entry.id}, type=${entry.type}`);
				this._database?.delete(entry);
				return false;
			}
			return true;
		});

		// Clamp future timestamps to now (fixes clock drift / timezone bugs)
		const now = GLib.DateTime.new_now_utc();
		for (const entry of validEntries) {
			if (entry.datetime && entry.datetime.compare(now) > 0) {
				this.ext.logger.warn(`Clamping future datetime for entry ${entry.id}: ${entry.datetime.format_iso8601()} → now`);
				entry.datetime = now;
				await this._database?.updateProperty(entry, 'datetime');
			}
		}

		// Track all entries
		this.track(...validEntries);

		// Delete oldest entries
		await this.deleteOldest();
		return validEntries;
	}

	getFile() {
		// Check if DEBUG_COPYOUS_DBPATH is set
		const environment = GLib.get_environ();
		const debugPath = GLib.environ_getenv(environment, 'DEBUG_COPYOUS_DBPATH');
		if (debugPath) {
			this.ext.logger.log('Using debug database');
			return Gio.File.new_for_path(debugPath);
		}

		// Get database location or use default ${XDG_DATA_HOME}/${EXTENSION UUID}
		const location = this.ext.settings.get_string('database-location');
		return location ? Gio.File.new_for_path(location) : getDefaultDatabaseFile(this.ext, DatabaseBackend.Default);
	}

	async initSqlite(file, showError) {
		try {
			// Check if DEBUG_COPYOUS_GDA_VERSION is set
			const environment = GLib.get_environ();
			const gdaVersion = GLib.environ_getenv(environment, 'DEBUG_COPYOUS_GDA_VERSION');
			if (gdaVersion) {
				imports.package.require({ Gda: gdaVersion });
			}
		} catch (err) {
			this.ext.logger.warn(err);
		}
		let gda;
		try {
			gda = (await import('gi://Gda')).default;
		} catch {
			// warn, not error: a machine without libgda is an expected environment, not a
			// defect -- and the user already gets the notification below. `logger.error` renders
			// as a shell CRITICAL, which is the line the regression gate counts, so one absent
			// typelib would keep that machine's log permanently red.
			this.ext.logger.warn(`Failed to load Gda`);
			if (showError && !this.ext.settings.get_boolean('disable-gda-warning')) {
				this.ext.notificationManager?.warning(
					_('Failed to load Gda'),
					_('Clipboard history will be disabled'),
					[_('Disable Warning'), () => this.ext.settings.set_boolean('disable-gda-warning', true)],
				);
			}
			return null;
		}
		try {
			this.ext.logger.log(`Using ${file === null ? 'in-memory ' : ''}Gda ${gda.__version__} database`);
			this._database = new GdaDatabase(this.ext, gda, file);
			await this._database.init();
			return await this._database.entries();
		} catch (e) {
			this.ext.logger.error('Failed to load Gda', e);
			// Same guard as the module-load branch above. Both print the identical
			// notification, and honouring "Disable Warning" in only one of them makes the
			// preference look like it does nothing on the path that actually fails here.
			if (showError && !this.ext.settings.get_boolean('disable-gda-warning')) {
				this.ext.notificationManager?.warning(
					_('Failed to load Gda'),
					_('Clipboard history will be disabled'),
					[_('Disable Warning'), () => this.ext.settings.set_boolean('disable-gda-warning', true)],
				);
			}
			return null;
		}
	}

	async initJson(file) {
		if (file === null) return await this.initMemory();
		try {
			this.ext.logger.log('Using JSON database');
			this._database = new JsonDatabase(this.ext, file);
			await this._database.init();
			return await this._database.entries();
		} catch (e) {
			this.ext.logger.error('Failed to initialize JSON database', e);
			this.ext.notificationManager?.warning(_('Failed to load JSON'), _('Clipboard history will be disabled'));
			return null;
		}
	}

	async initMemory() {
		this.ext.logger.log('Using in-memory database');
		this._database = new MemoryDatabase();
		await this._database.init();
		return [];
	}

	async clear(history = null) {
		if (!this._database) return;
		history ??= this.ext.settings.get_enum('clipboard-history');
		const deleted = await this._database.clear(history);
		deleted.forEach((id) => this.deleteFromDatabase(id));
	}

	async destroy() {
		this._destroyed = true;
		for (const entry of this._entries.values()) {
			entry.disconnectObject(this);
		}
		this._entries.clear();
		await this._database?.close();
		this._database = undefined;
	}

	/**
	 * Inserts an entry into the database
	 * @param type The type of the entry
	 * @param content The content of the entry
	 * @param metadata The metadata of the entry
	 * @returns The inserted entry or null if the entry could not be inserted or is already tracked
	 */
	async insert(type, content, metadata = null) {
		this._insertPromise = this._insertPromise.then(
			() => this._doInsert(type, content, metadata),
			() => this._doInsert(type, content, metadata),
		);
		return this._insertPromise;
	}

	async _doInsert(type, content, metadata) {
		const id = await this._database?.selectConflict({ type, content });
		if (id) {
			// Check if the entry is already tracked
			const trackedEntry = this._entries.get(id);
			if (trackedEntry) {
				trackedEntry.datetime = GLib.DateTime.new_now_utc();
				return null;
			}
		}
		const entry = await this._database?.insert(type, content, metadata);
		if (!entry) return null;

		// Start tracking it
		this.track(entry);

		// Only prune once an entry can actually be evicted: either the number of
		// prunable entries has passed the limit, or one of them has aged past the
		// time limit. Pruning on every insert cost two extra SQL statements (an
		// ORDER BY datetime scan plus the DELETE) even when nothing was deleted,
		// which is the common case -- the prunable count normally sits exactly at
		// the limit.
		if (this._prunableCount() > this.ext.settings.get_int('history-length') || this.checkOldest()) {
			await this.deleteOldest();
		}
		return entry;
	}

	checkOldest() {
		const M = this.ext.settings.get_int('history-time');
		if (M === 0) return false;
		const now = GLib.DateTime.new_now_utc();
		const olderThan = now.add_minutes(-M);
		for (const entry of this._entries.values()) {
			if (entry.pinned || entry.tag) continue;
			if (entry.datetime.compare(olderThan) < 0) return true;
		}
		return false;
	}

	// Number of tracked entries that pruning is allowed to remove. Pinned and
	// tagged entries are always protected, matching the predicate used by the
	// database backends.
	_prunableCount() {
		let count = 0;
		for (const entry of this._entries.values()) {
			if (!entry.pinned && !entry.tag) count++;
		}
		return count;
	}

	// Serialize pruning the same way insert() serializes writes: enable() fires
	// initEntryTracker() and initHistoryTimeout() without awaiting either, and
	// both end up here, so two write transactions could reach the same Gda
	// connection at once -- SQLite then answers "database is locked" and gda.js
	// swallows it, silently skipping the prune.
	deleteOldest() {
		this._deleteOldestPromise = this._deleteOldestPromise.then(
			() => this._doDeleteOldest(),
			() => this._doDeleteOldest(),
		);
		return this._deleteOldestPromise;
	}

	async _doDeleteOldest() {
		// A disable() while this call sat in the queue clears ext.settings.
		if (!this.ext.settings) return;
		const N = this.ext.settings.get_int('history-length');
		const M = this.ext.settings.get_int('history-time');
		const deleted = await this._database?.deleteOldest(N, M);
		if (deleted) deleted.forEach((id) => this.deleteFromDatabase(id));
	}

	track(...entries) {
		for (const entry of entries) {
			entry.connectObject('notify::content', async () => {
				try {
					const id = await this._database?.updateProperty(entry, 'content');

					// If entry conflicts with another entry, delete it
					if (id !== undefined && id >= 0) {
						entry.emit('delete');

						// Update the date of the other entry
						const conflicted = this._entries.get(id);
						if (conflicted) {
							conflicted.datetime = entry.datetime;
						}
					}
				} catch (error) {
					console.error('[Copyous] Error updating content:', error.message);
				}
			}, this);
			entry.connectObject('notify::pinned', () => this._database?.updateProperty(entry, 'pinned'), this);
			entry.connectObject('notify::tag', () => this._database?.updateProperty(entry, 'tag'), this);
			entry.connectObject('notify::datetime', () => this._database?.updateProperty(entry, 'datetime'), this);
			entry.connectObject('notify::metadata', () => this._database?.updateProperty(entry, 'metadata'), this);
			entry.connectObject('notify::title', () => this._database?.updateProperty(entry, 'title'), this);
			entry.connectObject('delete', () => this.delete(entry), this);
			this._entries?.set(entry.id, entry);
		}
	}

	async delete(entry) {
		if (entry.type === ItemType.Image) {
			// Delete image
			try {
				const file = Gio.File.new_for_uri(entry.content);
				if (file.query_exists(null)) {
					file.delete(null);
				}
			} catch {
				this.ext.logger.error('Failed to delete image', entry.content);
			}
		} else if (entry.type === ItemType.Link && entry.metadata) {
			// Delete thumbnail image
			const metadata = { image: null, ...entry.metadata };
			if (metadata.image) {
				try {
					const file = getLinkImagePath(this.ext, metadata.image);
					if (file?.query_exists(null)) {
						file.delete(null);
					}
				} catch {
					this.ext.logger.error('Failed to delete thumbnail image', metadata.image);
				}
			}
		}

		// Delete from database if not deleted already
		if (this._entries.has(entry.id)) {
			await this._database?.delete(entry);
			entry.disconnectObject(this);
			this._entries.delete(entry.id);
		}
	}

	deleteFromDatabase(id) {
		const entry = this._entries.get(id);
		if (entry) {
			this._entries.delete(id);
			entry.emit('delete');
		}
	}
}
