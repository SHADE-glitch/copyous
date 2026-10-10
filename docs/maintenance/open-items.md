# 已知不修 / 待确认

这里只放「知道、但故意没修」和「等你拍板」两类。已经修完并有门守着的，在 `CHANGELOG.md` 与 README 的分歧清单里。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 12 节。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 12. 已知不修 / 待确认

不在这里重复，指针：

- 有意未修的分歧点与理由 → [README.zh-CN.md](../../README.zh-CN.md#已知但有意未修的分歧点)
  （含横向列表 15px/端的 extent 偏差、`deleteOldest` 的字符串手术、`highlightAuto` 切片长度等）
- **复制图片仍会钉住主线程一次，约 24–46ms（2026-10-09 实测）**。`NotificationManager.preview()` 已经把两趟全量解码（`get_file_info` + `new_from_file_at_scale`，旧代码 46–130ms）压成一趟，但**压不到零**：gdk-pixbuf 的 PNG 路径在数据结束才 inflate —— 把 `PixbufLoader` 按 64KB 切片、片间让出主循环，实测每片 0.5–0.9ms 而 `close()` 仍 62ms；`new_from_stream_at_scale_async` 也只是异步读，解码还是 32–50ms 一整块。再往下只有两条路：通知里不放图片预览（= 删功能），或起子进程解码（= 新机制）。两条都要用户拍板，所以这里只记不修。判据与数值见探针 10 与 `lib/misc/notifications.js` 的注释。
- **没有任何判据保证 journal 里不出现剪贴板正文。** D-050 改掉的是当场找到的两处（`Unknown item type`
  打印整个 entry；动作的 stderr 原样落盘，而它的 stdin 就是条目正文）。这类泄漏至今**没有门**：
  `shell-internals.mjs` 只数依赖，探针只在隔离库里跑，没人回头看日志内容。可做的形状是现成的 ——
  fixture 的正文是已知合成本文，L1 可以拿它当哨兵：任何会话的 shell 日志里出现 fixture 条目正文的
  一行就红。代价是每个会话多一次全文比对，并且要放过 id、时长、字节数这类合法数字。等你点头。
- 给 agent 的硬规则（不许 rebase / 不许改 uuid / 不许引入构建链 / 提交规范）→ [AGENTS.md](../../AGENTS.md)
