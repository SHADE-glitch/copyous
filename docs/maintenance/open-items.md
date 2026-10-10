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
- **探针超时会偶发把嵌套壳的主线程钉死；本会话见过 7 次，其中两次有阶段名，两次都落在 `scroll`（2026-10-10）**。
  七次是：horizontal/`06-ux-hidden` 四次（09:52、10:25、12:06、13:17）、`live`/`06` 一次（13:05）、
  unwindowed/`06` 一次（10:48）、unwindowed/`07-wiring` 一次（10:56）。同一件事立刻重跑又全绿：
  `run.sh all 06` 里 12:32 那轮**三条臂全绿**、批量 1 的 12 跑里 11 跑绿 ⇒ **间歇、不可按需复现**，
  读数 `docs/reports/06-phasebudget-three-arms.txt`、`/tmp/bisect-06.log`。
  钉死时测到：主线程 `state=S`、`wchan=futex_do_wait`、6 秒内 `utime+stime` 一字不动（**不是在忙**）；`gdbus` 的 `Eval` 8 秒无应答；
  SIGTERM 无效（要靠 D-053 的 KILL 升级才收得走）；unwindowed 那两次日志停在 `warmup took` 之后、**对话框根本没开**（没有 `open():` 行），
  horizontal 那次则走到过 open() 并在 206 条 `Can't update stage views actor … needs an allocation` 之后完全沉默。
  **已排除四条**：媒体时长的正常路径 —— `13-media-duration` 三臂都绿，时长与 wav 的 RIFF 头推导一致；
  **并发媒体探测把主线程锁死** —— 定向实验里两条 pipeline 同时在飞、各带那圈 50ms 轮询，**53ms 双双落定**
  （`PASS 2/2`；不轮询时 12ms 就返回，且 `ok=false`、`dur=-1` —— 立即查询本来就取不到时长），
  原文 `docs/reports/media-race-concurrency.txt` ⇒ 这个形状**不成立**；死循环 —— CPU 是冻住的；
  探针前缀撞车 —— 那是 D-054，且它的标志是 eval 路径不存在。
  最新一次的快照还排除换页：`majflt 9 → 9` / `majflt 8 → 8`、`SwapFree 14472896 kB`，而线程表里有 `wavparse0:sink` 与 `typefind:sink`。
  **归因到哪一步了**（D-059）：`co.phase` 开工前打一行标记、快照多一节 `probe phases reached:` 把它从噪声里捞出来，
  于是 13:05 那次报出 `open` + `scroll`（没有后续），13:17 那次报出 `scroll pass=0 step=38…49` ——
  横向 `per=262 rowsPerViewport=5 max=64237` 的循环上界正是 i=49，也就是**"滚到最底"那一步**。
  两次带名字的样本都在 `scroll`，但**这不等于原因就在这里**：跳掉 `scroll` 的 5 跑全绿，在这个发生率下不构成判定。
  **还没分开的那件事**：那一步里卡的是 `adj().value=` 触发的重排，还是随后的 `sleep` 没回来 —— 现在每步打两条标记
  （`step=i` 与 `step=i assigned value=…ms`），批量 2 的 30 跑就是冲它去的。
  另外三条仪器侧的已做掉：(c) 超时快照（D-055 / `3bbc8ae`）、(a) 阶段预算（D-057）、二分用的
  `CO_SKIP_PHASES` 旋钮与它的守卫（D-059）。真实会话（竖向 + 固定行高）没观察到，但 06 量的就是滚动，
  横向还是全新安装的默认布局，所以不能记成"产品面为零"。
- 给 agent 的硬规则（不许 rebase / 不许改 uuid / 不许引入构建链 / 提交规范）→ [AGENTS.md](../../AGENTS.md)
