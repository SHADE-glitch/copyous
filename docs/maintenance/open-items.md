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
- **探针超时会偶发把嵌套壳的主线程钉死；本会话见过 5 次，跨三条臂里的两个探针，而同一对探针立刻重跑又全绿（2026-10-10）**。
  五次是：horizontal/`06-ux-hidden` 三次（09:52、10:25、12:06）、unwindowed/`06` 一次（10:48）、unwindowed/`07-wiring` 一次（10:56）；
  加上装上阶段上限后 `run.sh all 06` 的两轮：12:06 那轮 live **15/15**、unwindowed **5/5** 绿着而 horizontal 又钉，
  12:32 那轮**三条臂全绿**（horizontal 也 **15/15**）⇒ **间歇、不可按需复现**，读数 `docs/reports/06-phasebudget-three-arms.txt`。
  钉死时测到：主线程 `state=S`、`wchan=futex_do_wait`、6 秒内 `utime+stime` 一字不动（**不是在忙**）；`gdbus` 的 `Eval` 8 秒无应答；
  SIGTERM 无效（要靠 D-053 的 KILL 升级才收得走）；unwindowed 那两次日志停在 `warmup took` 之后、**对话框根本没开**（没有 `open():` 行），
  horizontal 那次则走到过 open() 并在 206 条 `Can't update stage views actor … needs an allocation` 之后完全沉默。
  **已排除四条**：媒体时长的正常路径 —— `13-media-duration` 三臂都绿，时长与 wav 的 RIFF 头推导一致；
  **并发媒体探测把主线程锁死** —— 定向实验里两条 pipeline 同时在飞、各带那圈 50ms 轮询，**53ms 双双落定**
  （`PASS 2/2`；不轮询时 12ms 就返回，且 `ok=false`、`dur=-1` —— 立即查询本来就取不到时长），
  原文 `docs/reports/media-race-concurrency.txt` ⇒ 这个形状**不成立**；死循环 —— CPU 是冻住的；
  探针前缀撞车 —— 那是 D-054，且它的标志是 eval 路径不存在。
  最新一次的快照还排除换页：`majflt 9 → 9`、`SwapFree 14472896 kB`，而线程表里有 `wavparse0:sink` 与 `typefind:sink`。
  **没排除**：06 的滚动阶段与"open 时 `page_size` 是 0"的组合。插了标记的那份跑起来是 `per=262 rowsPerViewport=5 max=64237`，
  也就是分配在 1.2 秒后就绪，所以嫌疑是"某一步的 `await` 在没有打点时永不落定"，而打点本身改变了 interleaving —— 经典海森堡。
  **第三条已经做掉了**（D-055 / `3bbc8ae`）：`run_probe` 超时那一路现在先把现场写进 `$OUT/<config>-<name>.stall.txt`
  ——`state`/`wchan`、相隔 2 秒的两次 `majflt`（死锁 vs 换页风暴的分判据）、线程名直方图、`Eval` 的 rc、`SwapFree`。
  剩下两条：**(a) 已做掉**（D-057）—— 06 切成八个带预算的阶段 + 滚动循环 `STEP_CAP`，两条腿
  （永不落定 / 同步超时）都逼红过；但它对**这一种**钉死无效，必须写清：主线程被 C 卡住时 deadline
  发不出来、结果文件也不会写。补上的不是 deadline 而是**开工前打印的阶段标记** —— `co.phase` 先
  `print()` 一行 `[copyous-probe] phase <name> start …`，(c) 那份快照多一节 `probe phases reached:`
  把它捞出来（必须在 200 行噪声警告里 `grep`，只看日志尾部必然看不见）。这样下一次钉死至少知道是哪一段，
  而 **(b) 二分**要切的边界也有了 —— (b) 还是那件事：花若干个 8 分钟会话逐段排除，等点头。
  真实会话（竖向 + 固定行高）没观察到，但 06 量的就是滚动，横向还是全新安装的默认布局，
  所以不能记成"产品面为零"。
- 给 agent 的硬规则（不许 rebase / 不许改 uuid / 不许引入构建链 / 提交规范）→ [AGENTS.md](../../AGENTS.md)
