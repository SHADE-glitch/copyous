# Database discipline: location, permissions, backup, growth

Clipboard history is plaintext user data. A page to read before touching it: where the files land, what the permissions are tightened to, how to back up before a change, and the 250/500-entry tiers.

> **Origin**: section 7, moved verbatim from `MAINTENANCE.md` (520 lines / 12 sections before the split);
> only the relative links were rewritten for the new directory level. This file is the sole owner of
> these facts; do not restate them elsewhere.


## 7. Database discipline

- live DB: `~/.local/share/copyous@local/clipboard.db` (WAL mode, plus `-wal` / `-shm`).
- **Permissions**: the library holds verbatim plaintext history, so inside these three roots (the
  `copyous@local` under `$XDG_DATA_HOME` / `$XDG_CACHE_HOME` / `$XDG_CONFIG_HOME`) directories are
  always 0700 and files 0600. The mechanism has two layers: every write site carries
  `Gio.FileCreateFlags.PRIVATE` + a `GLib.chmod` after the write (`PRIVATE` only covers newly
  created files; an overwrite keeps the old mode, so chmod once more), and `makeStoredPrivate()` at
  the start of `enable()` corrects residue **already sitting on disk** as well (a write site cannot
  fix "the file the user never writes again"). The criterion is held by probe 08; when
  `database-location` points outside `$HOME`, the DB's own directory is also tightened to 0700 by
  `gda.js`.
  ⚠ `GLib.chmod(path, mode)` is the only usable call here: `Gio.File.set_attribute_uint32` setting
  `unix::set-perms` is rejected by the local backend ("not supported"), `gi://Unix` has no typelib,
  and `gi://GioUnix` does not introspect chmod/mkdir.
  ⚠ A walk must carry `Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS`: without it a link is reported as a
  regular file (mode 777), and `chmod` then follows the link to change a file outside the tree — a
  sandbox measurement changed an out-of-tree 0644 file to 0600, and probe 08's
  `symlinkTargetUntouched` pins exactly this.
- **Back up before any change that touches the DB** to `~/.local/share/copyous@local/backup/`, named
  `clipboard-prediag-<YYYYMMDD-HHMMSS>.db`, and run a `PRAGMA integrity_check` after backing up.
  Backups are plaintext history too; `makeStoredPrivate()` tightens them to 0700/0600; when you are
  sure they are no longer needed, **ask the user before deleting**.
- Read-only queries always use the URI form with `mode=ro`, to avoid accidentally triggering a checkpoint:
  ```sh
  sqlite3 "file:$HOME/.local/share/copyous@local/clipboard.db?mode=ro" 'select count(*) from clipboard;'
  ```
  The table is `clipboard` (not `entries`), with a `UNIQUE(type, content)` constraint — that is the
  deduplication mechanism, so colliding with it while bulk-generating data is normal.
- `.gitignore` already excludes `*.db*`. The repo root may have a 0-byte `clipboard.db` residue (from
  an old run where `DEBUG_COPYOUS_DBPATH` did not take effect); harmless, do not commit it.
- headless always goes through the fixture, and **never** points `DEBUG_COPYOUS_DBPATH` at the live DB.
