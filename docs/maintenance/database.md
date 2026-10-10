# 数据库纪律：位置、权限、备份、增长

剪贴板历史是明文用户数据。动它之前必读的一页：文件落在哪、权限收成什么样、改之前怎么备份、250/500 条的分层。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 7 节。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 7. 数据库纪律

- live DB：`~/.local/share/copyous@local/clipboard.db`（WAL 模式，另有 `-wal` / `-shm`）。
- **权限**：库里是逐字明文历史，所以这三根目录（`$XDG_DATA_HOME`/`$XDG_CACHE_HOME`/
  `$XDG_CONFIG_HOME` 下的 `copyous@local`）内一律目录 0700、文件 0600。机制是两层：
  每个写盘点带 `Gio.FileCreateFlags.PRIVATE` + 写完 `GLib.chmod`（`PRIVATE` 只管新建文件，
  覆盖写会沿用旧模式，所以补一次 chmod），以及 `enable()` 开头的 `makeStoredPrivate()`
  把**已经躺在盘上的**残留一并纠正（写盘点纠正不了"用户再也不写的那个文件"）。
  判据由探针 08 持有；`database-location` 指到 `$HOME` 之外时，DB 自己的目录也会被
  `gda.js` 收成 0700。
  ⚠ `GLib.chmod(path, mode)` 是这里唯一可用的调用：`Gio.File.set_attribute_uint32`
  设 `unix::set-perms` 被本地后端拒绝（"not supported"），`gi://Unix` 无 typelib，
  `gi://GioUnix` 不内省 chmod/mkdir。
  ⚠ 遍历必须带 `Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS`：不带时链接被报成普通文件
  （mode 777），`chmod` 就穿过链接改到树外的文件 —— 沙箱实测把一个 0644 的树外文件改成了 0600，
  探针 08 的 `symlinkTargetUntouched` 就是钉这条的。
- **任何涉及 DB 的改动之前先备份**到 `~/.local/share/copyous@local/backup/`，命名
  `clipboard-prediag-<YYYYMMDD-HHMMSS>.db`，备份后跑一次 `PRAGMA integrity_check`。
  备份也是明文历史，`makeStoredPrivate()` 会把它们收进 0700/0600；确认不再需要时**删之前问用户**。
- 只读查询一律用 URI 形式带 `mode=ro`，避免误触发 checkpoint：
  ```sh
  sqlite3 "file:$HOME/.local/share/copyous@local/clipboard.db?mode=ro" 'select count(*) from clipboard;'
  ```
  表名是 `clipboard`（不是 `entries`），有 `UNIQUE(type, content)` 约束 —— 它就是去重机制，
  批量造数据时撞它是正常的。
- `.gitignore` 已排除 `*.db*`。仓库根可能有个 0 字节的 `clipboard.db` 残留（来自
  `DEBUG_COPYOUS_DBPATH` 未生效的旧运行），无害，别去提交它。
- headless 永远走 fixture，**绝不**把 `DEBUG_COPYOUS_DBPATH` 指向 live DB。
