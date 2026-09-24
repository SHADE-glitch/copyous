import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { getDataPath } from '../common/constants.js';
import { ClipboardHistory } from '../common/settings.js';
import { ClipboardEntry } from './database.js';

const DATABASE_VERSION = 3;

function new_connection(Gda, cncString) {
	if (Gda.__version__ === '6.0') {
		// Gda 6
		return new Gda.Connection({
			provider: Gda.Config.get_provider('SQLite'),
			cncString,
		});
	} else {
		// Gda 5
		const conn = Gda.Connection.new_from_string('SQLite', cncString, null, Gda.ConnectionOptions.THREAD_ISOLATED);
		if (conn.cnc_string === cncString) return conn;

		// Workaround for database not being stored only in home location
		// Two <user>:<password>@ pairs are required since the first is stripped at creation and the second is stripped
		// while opening the connection.
		cncString = `:@:@${cncString}`;
		return Gda.Connection.new_from_string('SQLite', cncString, null, Gda.ConnectionOptions.THREAD_ISOLATED);
	}
}

function open_async(connection) {
	return new Promise((resolve, reject) => {
		if ('open_async' in connection) {
			// Gda 6
			GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
				try {
					connection.set_main_context(null, GLib.MainContext.ref_thread_default());
					connection.open_async((_cnc, _jobId, result) => resolve(result));
				} catch (error) {
					reject(error);
				}
				return GLib.SOURCE_REMOVE;
			});
		} else {
			// Gda 5
			resolve(connection.open());
		}
	});
}

function add_expr_value(builder, value) {
	if (builder.add_expr_value.length === 1) {
		return builder.add_expr_value(value);
	} else {
		return builder.add_expr_value(null, value);
	}
}

function convert_datetime(datetime) {
	return datetime.to_utc().format('%Y-%m-%d %H:%M:%S');
}

// Gda 5 exposes no completion callback for async statements, so the result has
// to be polled. A fixed 100ms interval meant the first check always ran a full
// 100ms after the statement was submitted, putting a >=100ms floor on every
// query (4 statements per copy, 5 at startup). Poll fast at first and back off;
// the overall budget stays at ~1s like the previous 10 x 100ms.
const GDA5_POLL_PLAN = [
	{ interval: 2, count: 25 }, // first 50ms
	{ interval: 10, count: 25 }, // next 250ms
	{ interval: 100, count: 7 }, // remaining 700ms
];

/**
 * Poll a Gda 5 async statement until it completes.
 * @param cancellable Cancellable used to abort polling
 * @param fetchResult Called on every poll; returns null while the statement is
 *   still running, { value } when done, or { error } when it failed
 */
function gda5_poll(cancellable, fetchResult) {
	return new Promise((resolve, reject) => {
		if (cancellable.is_cancelled()) {
			reject(new Error('Statement cancelled'));
			return;
		}

		let planIndex = 0;
		let stepsLeft = GDA5_POLL_PLAN[0].count;
		let timeoutId = 0;
		let cancellableId = 0;

		const stop = () => {
			if (timeoutId) {
				GLib.source_remove(timeoutId);
				timeoutId = 0;
			}
			if (cancellableId) {
				cancellable.disconnect(cancellableId);
				cancellableId = 0;
			}
		};

		const poll = () => {
			timeoutId = 0;
			try {
				const outcome = fetchResult();
				if (outcome) {
					stop();
					if (outcome.error) reject(outcome.error);
					else resolve(outcome.value);
					return GLib.SOURCE_REMOVE;
				}
				stepsLeft -= 1;
				if (stepsLeft <= 0) {
					planIndex += 1;
					if (planIndex >= GDA5_POLL_PLAN.length) {
						stop();
						reject(new Error('Timeout'));
						return GLib.SOURCE_REMOVE;
					}
					stepsLeft = GDA5_POLL_PLAN[planIndex].count;
				}
				timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GDA5_POLL_PLAN[planIndex].interval, poll);
				return GLib.SOURCE_REMOVE;
			} catch (error) {
				stop();
				reject(error);
				return GLib.SOURCE_REMOVE;
			}
		};

		cancellableId = cancellable.connect(() => {
			stop();
			// Settle the promise so callers (and the serialized insert chain in
			// ClipboardEntryTracker) can never stall forever on a cancelled query.
			reject(new Error('Statement cancelled'));
		});

		timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GDA5_POLL_PLAN[0].interval, poll);
	});
}

// Bind values to a parsed statement's ##name::type parameters and return the
// Gda.Set to pass to the executor. Parameters bypass libgda's SQL string
// rendering entirely — including its broken backslash escaping for SQLite
// literals — so values are stored in the database exactly as provided.
// Null/undefined values are skipped, leaving any declared ::NULL default
// (e.g. ##tag::string::NULL) in place, which is how SQL NULL is bound.
function bindParams(stmt, values) {
	const result = stmt.get_parameters();
	const set = Array.isArray(result) ? result[1] : result;
	for (const [name, value] of Object.entries(values)) {
		if (value === null || value === undefined) continue;
		set.get_holder(name).set_value(value);
	}
	return set;
}

function async_statement_execute_select(Gda, connection, statement, cancellable, params = null) {
	if ('async_statement_execute' in connection) {
		// Gda 5
		const id = connection.async_statement_execute(
			statement,
			params,
			Gda.StatementModelUsage.RANDOM_ACCESS,
			null,
			false,
		);
		return gda5_poll(cancellable, () => {
			const [result] = connection.async_fetch_result(id);
			if (!result) return null;
			if (!(result instanceof Gda.DataModel))
				return { error: new Error('Statement is not a selection statement') };
			return { value: result };
		});
	}

	// Gda 6
	return new Promise((resolve, reject) => {
		GLib.idle_add(GLib.PRIORITY_HIGH, () => {
			try {
				const datamodel = connection.statement_execute_select(statement, params);
				resolve(datamodel);
			} catch (error) {
				reject(error);
			}
			return GLib.SOURCE_REMOVE;
		});
	});
}

function async_statement_execute_non_select(Gda, connection, statement, cancellable, params = null) {
	if ('async_statement_execute' in connection) {
		// Gda 5
		const id = connection.async_statement_execute(
			statement,
			params,
			Gda.StatementModelUsage.RANDOM_ACCESS,
			null,
			true,
		);
		return gda5_poll(cancellable, () => {
			const [result, lastRow] = connection.async_fetch_result(id);
			if (!result) return null;
			if (!(result instanceof Gda.Set))
				return { error: new Error('Statement is a selection statement') };
			const rows = result.get_holder_value('IMPACTED_ROWS');
			return { value: [rows ?? -2, lastRow] };
		});
	}

	// Gda 6
	return new Promise((resolve, reject) => {
		GLib.idle_add(GLib.PRIORITY_HIGH, () => {
			try {
				const result = connection.statement_execute_non_select(statement, params);
				resolve(result);
			} catch (error) {
				reject(error);
			}
			return GLib.SOURCE_REMOVE;
		});
	});
}

/**
 * Database with Gda backend
 */
export class GdaDatabase {
	ext;
	_Gda;
	_connection;
	_cancellable = new Gio.Cancellable();

	constructor(ext, gda, file) {
		this.ext = ext;
		this._Gda = gda;
		let cncString;
		if (file) {
			const dir = file.get_parent() ?? getDataPath(ext);
			if (!dir.query_exists(null)) {
				dir.make_directory_with_parents(null);
			}
			const fileName = file.get_basename()?.replace(/\.db$/, '') ?? 'clipboard';
			cncString = `DB_DIR=${dir.get_path()};DB_NAME=${fileName}`;
		} else {
			cncString = 'DB_NAME=:memory:';
		}

		// Establish connection
		this._connection = new_connection(this._Gda, cncString);
	}

	async init() {
		await open_async(this._connection);
		this.ext.logger.info('Opened database connection');

		// Must run before any other statement on this connection, see below.
		this.applyPerformancePragmas();

		// Version table
		const [versionTableStmt] = this._connection.parse_sql_string(`
			CREATE TABLE IF NOT EXISTS 'clipboard_version' (
				'id'      integer PRIMARY KEY CHECK (id = 1),
				'version' integer
			)`);
		await async_statement_execute_non_select(this._Gda, this._connection, versionTableStmt, this._cancellable);

		// Get current schema version
		// SELECT (version) FROM 'clipboard_version'
		const builder1 = new this._Gda.SqlBuilder({ stmt_type: this._Gda.SqlStatementType.SELECT });
		builder1.select_add_target('clipboard_version', null);
		builder1.select_add_field('version', null, null);
		const versionStmt = builder1.get_statement();
		const versionResult = await async_statement_execute_select(
			this._Gda,
			this._connection,
			versionStmt,
			this._cancellable,
		);
		let version = 0;
		if (versionResult.get_n_rows() > 0) {
			// Get version
			const versionIter = versionResult.create_iter();
			versionIter.move_next();
			version = versionIter.get_value_for_field('version');
		} else {
			// Insert default version
			const [addVersionStmt] = this._connection.parse_sql_string(
				`INSERT OR IGNORE INTO clipboard_version (id, version) VALUES (1, 0)`,
			);
			await async_statement_execute_non_select(this._Gda, this._connection, addVersionStmt, this._cancellable);
		}

		// Run migrations based on version
		switch (version) {
			case 0: {
				// Create table
				const [stmt] = this._connection.parse_sql_string(`
					CREATE TABLE IF NOT EXISTS 'clipboard' (
						'id'       integer   NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT,
						'type'     text      NOT NULL,
						'content'  text      NOT NULL,
						'pinned'   boolean   NOT NULL,
						'tag'      text,
						'datetime' timestamp NOT NULL,
						'metadata' text,
						UNIQUE ('type', 'content')
					);
				`);
				await async_statement_execute_non_select(this._Gda, this._connection, stmt, this._cancellable);
			}

			/* falls through */
			case 1: {
				try {
					// Add title column
					const [addColumnStmt] = this._connection.parse_sql_string(
						`ALTER TABLE 'clipboard' ADD COLUMN 'title' text;`,
					);
					await async_statement_execute_non_select(
						this._Gda,
						this._connection,
						addColumnStmt,
						this._cancellable,
					);
				} catch {
					// Ignore
				}
			}

			/* falls through */
			case 2: {
				// v3: values are now bound through Gda parameters (see bindParams),
				// which store content/metadata/title exactly as provided. Rows
				// written by earlier versions went through libgda's SQL string
				// rendering, which doubles every backslash. Fold doubled
				// backslashes back once. replace() consumes pairs from the left,
				// exactly matching the read-side compensation this replaces
				// (verified equivalent for all pair patterns).
				for (const column of ['content', 'metadata', 'title']) {
					const [foldStmt] = this._connection.parse_sql_string(
						`UPDATE clipboard SET ${column} = replace(${column}, char(92) || char(92), char(92)) ` +
							`WHERE instr(${column}, char(92) || char(92)) > 0`,
					);
					await async_statement_execute_non_select(
						this._Gda,
						this._connection,
						foldStmt,
						this._cancellable,
					);
				}
			}
		}

		// Update to current version
		if (version !== DATABASE_VERSION) {
			// UPDATE 'version' SET version=DATABASE_VERSION
			const builder2 = new this._Gda.SqlBuilder({ stmt_type: this._Gda.SqlStatementType.UPDATE });
			builder2.set_table('clipboard_version');
			builder2.add_field_value_id(builder2.add_id('version'), add_expr_value(builder2, DATABASE_VERSION));
			const setVersionStmt = builder2.get_statement();
			await async_statement_execute_non_select(this._Gda, this._connection, setVersionStmt, this._cancellable);
			this.ext.logger.log(`Migrated database version from ${version} to ${DATABASE_VERSION}.`);
		}
	}

	// WAL + synchronous=NORMAL stops every write from syncing to disk. Measured
	// on this database: ~1.9ms per insert with the default delete+FULL, ~0.09ms
	// with wal+NORMAL. synchronous=NORMAL is only safe together with WAL -- it
	// can lose the last few committed transactions on power loss, but cannot
	// corrupt the file, which is a fine trade for clipboard history.
	//
	// journal_mode lives in the database header, so this is effectively a
	// once-per-file setting. It must run before any other statement on the
	// connection: libgda keeps an implicit transaction open while a recordset is
	// alive, and SQLite refuses to switch to WAL from inside a transaction.
	applyPerformancePragmas() {
		// Both pragmas return a row, so they have to go through the select
		// executor; execute_non_select_command rejects them as a selection
		// statement.
		for (const sql of [
			'PRAGMA journal_mode=WAL',
			'PRAGMA synchronous=NORMAL',
			// Wait briefly instead of failing instantly when another write
			// transaction holds the lock (the preferences window shares this file,
			// and two deleteOldest() calls used to overlap at startup). 800ms
			// deliberately stays under the ~1000ms GDA5_POLL_PLAN budget: a
			// contended statement then either acquires the lock and reports a real
			// result, or fails with SQLITE_BUSY -- instead of the poller giving up
			// with a timeout while the statement goes on to succeed in libgda's
			// thread, which would report failure for a write that actually landed.
			'PRAGMA busy_timeout=800',
		]) {
			try {
				this._connection.execute_select_command(sql);
			} catch (e) {
				// Read-only databases, :memory: databases and filesystems without
				// shared-memory support all refuse this. Keep working as-is.
				this.ext.logger.info(`Could not apply "${sql}": ${e.message}`);
			}
		}
	}

	async clear(history) {
		try {
			if (history === ClipboardHistory.KeepAll) {
				return [];
			}

			// SELECT id FROM table (WHERE NOT (pinned == true OR tag IS NOT NULL))?
			const [selectBuilder, where] = this.selectToDeleteBuilder(history === ClipboardHistory.KeepPinnedAndTagged);
			const selectStmt = selectBuilder.get_statement();
			const datamodel = await async_statement_execute_select(
				this._Gda,
				this._connection,
				selectStmt,
				this._cancellable,
			);
			const deleted = [];
			const iter = datamodel.create_iter();
			while (iter.move_next()) {
				deleted.push(iter.get_value_for_field('id'));
			}

			// Only delete if there are entries to delete
			if (deleted.length > 0) {
				// DELETE FROM table (WHERE ...)? RETURNING id;
				const deleteBuilder = new this._Gda.SqlBuilder({ stmt_type: this._Gda.SqlStatementType.DELETE });
				deleteBuilder.set_table('clipboard');
				if (where) {
					deleteBuilder.set_where(deleteBuilder.import_expression_from_builder(selectBuilder, where));
				}
				const deleteStmt = deleteBuilder.get_statement();
				await async_statement_execute_non_select(this._Gda, this._connection, deleteStmt, this._cancellable);
			}
			return deleted;
		} catch (e) {
			this.ext.logger.error('Failed to clear clipboard', e);
		}
		return [];
	}

	close() {
		this._connection.close();
		this._cancellable.cancel();
		this._cancellable = new Gio.Cancellable();
		return Promise.resolve();
	}

	// Convert one datamodel row into a ClipboardEntry. Field names must match
	// the SELECT column names.
	createEntryFromIter(iter) {
		const id = iter.get_value_for_field('id');
		const type = iter.get_value_for_field('type');
		const content = iter.get_value_for_field('content');
		const pinned = iter.get_value_for_field('pinned');
		const tag = iter.get_value_for_field('tag');
		let datetime = iter.get_value_for_field('datetime');
		const metadata = iter.get_value_for_field('metadata');
		const title = iter.get_value_for_field('title') ?? '';
		if ('Timestamp' in this._Gda && datetime instanceof this._Gda.Timestamp) {
			const timezone = GLib.TimeZone.new_utc();
			datetime = GLib.DateTime.new(
				timezone,
				datetime.year,
				datetime.month,
				datetime.day,
				datetime.hour,
				datetime.minute,
				datetime.second,
			);
		}
		let metadataObj = null;
		if (metadata) {
			try {
				const json = JSON.parse(metadata);
				if (json) {
					metadataObj = json;
				}
			} catch {
				this.ext.logger.error('Failed to parse metadata');
			}
		}
		return new ClipboardEntry(id, type, content, pinned, tag, datetime, metadataObj, title);
	}

	async entries() {
		try {
			// SELECT * FROM clipboard
			const builder = new this._Gda.SqlBuilder({ stmt_type: this._Gda.SqlStatementType.SELECT });
			builder.select_add_target('clipboard', null);
			builder.select_add_field('id', null, null);
			builder.select_add_field('type', null, null);
			builder.select_add_field('content', null, null);
			builder.select_add_field('pinned', null, null);
			builder.select_add_field('tag', null, null);
			const datetimeId = builder.select_add_field('datetime', null, null);
			builder.select_add_field('metadata', null, null);
			builder.select_add_field('title', null, null);
			builder.select_order_by(datetimeId, false, null);
			const stmt = builder.get_statement();
			const dataModel = await async_statement_execute_select(
				this._Gda,
				this._connection,
				stmt,
				this._cancellable,
			);
			const entries = [];
			const iter = dataModel.create_iter();
			while (iter.move_next()) {
				entries.push(this.createEntryFromIter(iter));
			}
			return entries;
		} catch (e) {
			this.ext.logger.error('Failed to get clipboard entries', e);
		}
		return [];
	}

	async selectConflict(entry) {
		try {
			// SELECT id FROM table WHERE type == entry.type AND content == entry.content LIMIT 1
			// Values are bound as parameters so the comparison matches how
			// insert() stores them (raw, no libgda literal escaping).
			const [stmt] = this._connection.parse_sql_string(
				'SELECT id FROM clipboard WHERE type = ##type::string AND content = ##content::string LIMIT 1',
			);
			const params = bindParams(stmt, { type: entry.type, content: entry.content });
			const datamodel = await async_statement_execute_select(
				this._Gda,
				this._connection,
				stmt,
				this._cancellable,
				params,
			);
			const iter = datamodel.create_iter();
			if (iter.move_next()) {
				return iter.get_value_for_field('id');
			}
			return null;
		} catch (e) {
			this.ext.logger.error('Failed to select conflicting entry', e);
		}
		return null;
	}

	// Fetch the full row matching (type, content). Used by insert() when the
	// entry already exists, so the returned entry carries the stored
	// pinned/tag/metadata state instead of fresh defaults.
	async selectEntryByConflict(type, content) {
		const [stmt] = this._connection.parse_sql_string(
			'SELECT id, type, content, pinned, tag, datetime, metadata, title FROM clipboard ' +
				'WHERE type = ##type::string AND content = ##content::string LIMIT 1',
		);
		const params = bindParams(stmt, { type, content });
		const dataModel = await async_statement_execute_select(
			this._Gda,
			this._connection,
			stmt,
			this._cancellable,
			params,
		);
		const iter = dataModel.create_iter();
		if (iter.move_next()) {
			return this.createEntryFromIter(iter);
		}
		return null;
	}

	/// Insert an entry. Values are bound through Gda parameters, which bypasses
	/// libgda's broken backslash escaping for SQLite literals: content is
	/// stored exactly as provided. A (type, content) conflict no longer raises
	/// a UNIQUE error — the existing row's datetime is bumped and the stored
	/// row is returned instead.
	async insert(type, content, metadata = null) {
		try {
			const datetime = GLib.DateTime.new_now_utc();

			// INSERT OR IGNORE INTO table (type, content, pinned, datetime, metadata, title) VALUES (...)
			const [insertStmt] = this._connection.parse_sql_string(
				'INSERT OR IGNORE INTO clipboard (type, content, pinned, datetime, metadata, title) ' +
					'VALUES (##type::string, ##content::string, ##pinned::boolean, ##datetime::string, ##metadata::string::NULL, ##title::string::NULL)',
			);
			const insertParams = bindParams(insertStmt, {
				type,
				content,
				pinned: false,
				datetime: convert_datetime(datetime),
				metadata: metadata ? JSON.stringify(metadata) : null,
				title: null,
			});
			const [rows, lastRow] = await async_statement_execute_non_select(
				this._Gda,
				this._connection,
				insertStmt,
				this._cancellable,
				insertParams,
			);

			// Fresh insert: the lastRow holder carries the new rowid.
			if (rows >= 1) {
				const id = lastRow?.get_nth_holder(0)?.get_value();
				if (id == null) return null;
				return new ClipboardEntry(id, type, content, false, null, datetime, metadata);
			}

			// rows == 0: the entry already exists (or was concurrently deleted).
			// Bump its datetime so re-copying moves it to the top, then return
			// the stored row so pinned/tag/metadata state is preserved.
			const [bumpStmt] = this._connection.parse_sql_string(
				'UPDATE clipboard SET datetime = ##datetime::string ' +
					'WHERE type = ##type::string AND content = ##content::string',
			);
			const bumpParams = bindParams(bumpStmt, {
				datetime: convert_datetime(datetime),
				type,
				content,
			});
			await async_statement_execute_non_select(
				this._Gda,
				this._connection,
				bumpStmt,
				this._cancellable,
				bumpParams,
			);
			return await this.selectEntryByConflict(type, content);
		} catch (e) {
			this.ext.logger.error('Failed to insert entry', e);
		}
		return null;
	}

	// Gda parameter type (with optional ::NULL default for nullable columns)
	// used by updateProperty to bind values per property.
	static UPDATE_PROPERTY_TYPES = {
		type: 'string',
		content: 'string',
		pinned: 'boolean',
		tag: 'string::NULL',
		datetime: 'string',
		metadata: 'string',
		title: 'string::NULL',
	};

	async updateProperty(entry, property) {
		const paramType = this.constructor.UPDATE_PROPERTY_TYPES[property];
		if (!paramType) return -1;
		try {
			let value = entry[property] ?? null;
			if (property === 'metadata') value = JSON.stringify(entry['metadata']);
			else if (property === 'datetime') value = convert_datetime(entry['datetime']);

			// UPDATE table SET property = value WHERE id == entry.id
			// Values are bound as parameters: no SQL string escaping (libgda's
			// is broken for backslashes) and real SQL NULLs for nullable
			// columns via their ::NULL default, without the previous
			// statement_to_sql string surgery.
			const [stmt] = this._connection.parse_sql_string(
				`UPDATE clipboard SET ${property} = ##v::${paramType} WHERE id = ##id::int`,
			);
			const params = bindParams(stmt, { v: value, id: entry.id });
			const [rows] = await async_statement_execute_non_select(
				this._Gda,
				this._connection,
				stmt,
				this._cancellable,
				params,
			);
			if (rows === 0 && (property === 'type' || property === 'content')) {
				// Zero impacted rows on an existing id means the UPDATE
				// violated the UNIQUE(type, content) constraint — libgda
				// reports that as 0 rows instead of an error.
				// Return the id of the conflicting entry.
				const id = await this.selectConflict(entry);
				return id ?? -1;
			}
			return -1; // success
		} catch (e) {
			// The same UNIQUE(type, content) violation usually surfaces as a
			// thrown gda_server_provider_error instead. If another row now
			// owns the value, report its id (the caller deletes the edited
			// entry and bumps the existing one) instead of logging an error
			// for what is a normal "edit to a duplicate" outcome.
			if (property === 'type' || property === 'content') {
				try {
					const id = await this.selectConflict(entry);
					if (id != null && id !== entry.id) return id;
				} catch {
					// fall through to the error log
				}
			}
			this.ext.logger.error(`Failed to update property "${property}" for entry ${entry.id}`, e);
		}
		return -1;
	}

	async delete(entry) {
		try {
			// DELETE FROM table WHERE id == entry.id
			const builder = new this._Gda.SqlBuilder({
				stmt_type: this._Gda.SqlStatementType.DELETE,
			});
			builder.set_table('clipboard');
			builder.set_where(
				builder.add_cond(
					this._Gda.SqlOperatorType.EQ,
					builder.add_id('id'),
					add_expr_value(builder, entry.id),
					0,
				),
			);
			const stmt = builder.get_statement();
			const [result] = await async_statement_execute_non_select(
				this._Gda,
				this._connection,
				stmt,
				this._cancellable,
			);
			return result > 0;
		} catch (e) {
			this.ext.logger.error(`Failed to delete entry ${entry.id}`, e);
		}
		return false;
	}

	async deleteOldest(offset, olderThanMinutes) {
		try {
			// WITH select1 AS (...) (SELECT id FROM select1) UNION (select2)
			const selectBuilder = new this._Gda.SqlBuilder({
				stmt_type: this._Gda.SqlStatementType.COMPOUND,
			});
			selectBuilder.compound_set_type(this._Gda.SqlStatementCompoundType.UNION);

			// SELECT id FROM table WHERE NOT (pinned == true OR tag IS NOT NULL) ORDER BY datetime LIMIT -1 OFFSET offset
			const [select1Builder] = this.selectToDeleteBuilder();
			select1Builder.select_order_by(select1Builder.add_id('datetime'), false, null);
			select1Builder.select_set_limit(add_expr_value(select1Builder, -1), add_expr_value(select1Builder, offset));

			// SELECT id FROM table WHERE NOT (pinned == true OR tag IS NOT NULL) AND datetime < DATETIME('now', '-n minutes')
			let selectStmt;
			if (olderThanMinutes > 0) {
				// Workaround for ORDER BY not working inside compound selector and add_subselect not being exposed in Gda 5.0
				const workAroundBuilder = new this._Gda.SqlBuilder({ stmt_type: this._Gda.SqlStatementType.SELECT });
				workAroundBuilder.select_add_field('id', null, null);
				workAroundBuilder.select_add_target('select1', null);
				selectBuilder.compound_add_sub_select_from_builder(workAroundBuilder);
				const [select2Builder] = this.selectToDeleteBuilder(true, olderThanMinutes);
				selectBuilder.compound_add_sub_select_from_builder(select2Builder);

				// SELECT id FROM (SELECT id FROM table WHERE ...)
				const select1Sql = this._connection.statement_to_sql(select1Builder.get_statement(), null, null)[0];
				const selectSql = this._connection.statement_to_sql(selectBuilder.get_statement(), null, null)[0];
				selectStmt = this._connection.parse_sql_string(selectSql.replace('select1', `(${select1Sql})`))[0];
			} else {
				// Ignore compound selector
				selectStmt = select1Builder.get_statement();
			}

			// Run select
			const datamodel = await async_statement_execute_select(
				this._Gda,
				this._connection,
				selectStmt,
				this._cancellable,
			);

			// DELETE FROM table WHERE id IN (select)
			// add_subselect is not exposed as a javascript binding in Gda 5.0
			const selectSql = this._connection.statement_to_sql(selectStmt, selectStmt.get_parameters()[1], null)[0];
			const [deleteStmt] = this._connection.parse_sql_string(`DELETE FROM clipboard WHERE id IN (${selectSql})`);
			const [rows] = await async_statement_execute_non_select(
				this._Gda,
				this._connection,
				deleteStmt,
				this._cancellable,
			);

			// Get ids
			const deleted = [];
			if (rows > 0) {
				const iter = datamodel.create_iter();
				while (iter.move_next()) {
					deleted.push(iter.get_value_for_field('id'));
				}
			}
			return deleted;
		} catch (e) {
			this.ext.logger.error('Failed to delete oldest entries', e);
		}
		return [];
	}

	selectToDeleteBuilder(includeWhere = true, olderThanMinutes = 0) {
		// SELECT id FROM table (WHERE NOT (pinned == true OR tag IS NOT NULL) (AND datetime < DATETIME('now', '-n minutes'))?)?
		const builder = new this._Gda.SqlBuilder({
			stmt_type: this._Gda.SqlStatementType.SELECT,
		});
		builder.select_add_field('id', null, null);
		builder.select_add_target('clipboard', null);
		let where = null;
		if (includeWhere) {
			// WHERE NOT (pinned == true OR tag IS NOT NULL)
			where = builder.add_cond(
				this._Gda.SqlOperatorType.NOT,
				builder.add_cond(
					this._Gda.SqlOperatorType.OR,
					builder.add_cond(
						this._Gda.SqlOperatorType.EQ,
						builder.add_id('pinned'),
						add_expr_value(builder, true),
						0,
					),
					builder.add_cond(this._Gda.SqlOperatorType.ISNOTNULL, builder.add_id('tag'), 0, 0),
					0,
				),
				0,
				0,
			);

			// AND datetime < DATETIME('now', '-n minutes')
			if (olderThanMinutes > 0) {
				where = builder.add_cond(
					this._Gda.SqlOperatorType.AND,
					where,
					builder.add_cond(
						this._Gda.SqlOperatorType.LT,
						builder.add_id('datetime'),
						builder.add_function('DATETIME', [
							add_expr_value(builder, 'now'),
							add_expr_value(builder, `-${olderThanMinutes} minutes`),
						]),
						0,
					),
					0,
				);
			}
			builder.set_where(where);
		}
		return [builder, where];
	}
}
