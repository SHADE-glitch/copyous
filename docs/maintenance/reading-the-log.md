# journal 怎么读、哪些字段能当回归判据

一条主线：**先拿到真实会话 shell 的 PID，再按 `_PID=` 过滤**。这个文件写清五种打印形态、归因规则，以及哪些数看着像结论其实是噪声。成本的读法与口径在 [cost-measurement.md](cost-measurement.md)。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 4 节与第 5 节（RSS 与滚动成本两条移入 cost-measurement.md）。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 4. 日志怎么读

先拿到**真实会话**的 shell PID —— 这一步有个坑：

```sh
# 错：会抓到 test/headless 遗留的 headless shell，内存数字全是它的
pgrep -x gnome-shell

# 对：真实会话 shell 带 --mode
pgrep -af "gnome-shell --mode"
# 或者显式排除
pgrep -x gnome-shell -a | grep -v -- --headless
```

判据：命令行里有 `--headless --wayland-display=wayland-copyous-harness` 的是测试进程，不是你的会话。

**`logger.error` 会被打成 `GNOME Shell-CRITICAL`**，`logger.warn` 不会。所以"可恢复的环境状况"
一律 `warn`，只有真坏了才 `error` —— 否则上面那条"CRITICAL 必须是 0"的闸门会被一次合法的
失败永久染红。踩点实例：`open()` 抢模态被拒（别的客户端持有 SYSTEM_MODAL）原本走 `error`，
探针 11 故意造出这条路径时就看见 `[Copyous] [Copyous] open(): pushModal grab failed`
以 CRITICAL 落盘；改成 `warn` 之后同一次运行 CRITICAL 归零。**顺带**：那条消息自己带了
`[Copyous] ` 前缀，而 logger 已经加过一次，日志里是双份 —— 消息体不要再写前缀。

2026-10-10 把整类扫了一遍（`rg 'logger\.error' extension.js lib` 去掉 prefs），**9 处降为 `warn`**：
Gda typelib 缺席、媒体时长探测失败、文件信息与文件预览建不出来、图片通知解码两处、链接元数据与
链接缩略图两处、stylesheet 载入失败、`makeStoredPrivate()` 没改成权限。留下的 `error` 只满足一条
标准：**用户的库或数据真的受损**（修剪失败、条目类型认不出、建条目抛异常、Gda 与 JSON 起不来、
删图与写库失败）。扫描时一个手误值得记在这里：`rg '\berror\('` 看不见 `.catch(error)` 这种
**把函数当回调传**的用法，于是删掉那行绑定把 enable() 直接打挂 —— 是 L1 闸门当场报的
`deferred enable failed: ReferenceError: error is not defined`，而 L0 看不见（`extension.js`
在 Node 里加载不了）。同一次扫描还查出两条**把用户内容写进 journal** 的调用（见 AGENTS.md 的
隐私条），改法是只留类型与 id。

```sh
LOG='journalctl --no-pager -o cat'
$LOG /usr/bin/gnome-shell | grep -a '\[timing\]'          # 全部计时
$LOG /usr/bin/gnome-shell | grep -acE 'CRITICAL|JS ERROR'  # 必须是 0
```

**第三种打印形式**（2026-10-09 血泪）：没人 `.catch` 的 promise 被拒时 GJS 打
`Unhandled promise rejection`，既不是 CRITICAL 也不是 JS ERROR —— `run.sh` 现在单独数它。
踩点实例：一份 `{}` 的 `actions.json` 让 `actionMenu.js` 与 `shortcuts.js` 各自的监听回调抛了
两次，条目菜单和动作快捷键当场失效整整 1.5 小时，而所有闸门一直是绿的。
`run.sh` 还有一条**用户数据绊线**：跑之前对 `~/.config/copyous@local` 取 `ls -l | cksum`，
跑完比一遍，不同就 `USER DATA TOUCHED` 并整轮判失败（`~/.local/share` 故意不比：真实会话一边
剪贴板一边写它，永远不同 = 永远假红）。

**第四种：访问已 dispose 的对象是 warning。** 得单独数，而且必须按 pid 过滤：

```sh
# ⚠ 上面那条数**不够**：GJS 把访问已 dispose 对象打成 warning，两个关键词都不匹配。
# 单独数它，而且必须按 pid —— logout 时上一个 shell 的拆除会刷一批，那些不归本仓库：
journalctl --no-pager -o cat --since="<本次登录时间>" _PID=<pid> | grep -ac 'has been already disposed'
# 归因看两处：栈帧里有没有 extensions/copyous@local/，消息头有没有点名 Gjs_common_gjs_<Class>
grep -E '^(Rss|Swap)' /proc/<pid>/smaps_rollup             # 常驻 / 被换出
awk '{print $12}' /proc/<pid>/stat                          # majflt
```

**第五种：C 侧的 GLib 断言。2026-10-10 才发现，前四种形态全都看不见它** —— GLib 自己写的失败
**消息体里根本没有 "CRITICAL" 这个词**，域名和级别在 journald 的结构字段里
（`PRIORITY=4`、`GLIB_DOMAIN=GLib-GObject`），所以按词计数的闸门一条都数不到：

```sh
# 本轮真实会话（PID 3147，08:03 起）现场三行
journalctl -b -o cat /usr/bin/gnome-shell | grep -acE 'CRITICAL|JS ERROR'   # 1  ← dash.js 那条，不是本仓
journalctl -b -o cat /usr/bin/gnome-shell | grep -acE 'assertion .* failed' # 1  ← g_object_unref: G_IS_OBJECT
journalctl -b all -o cat /usr/bin/gnome-shell | grep -acE "assertion .* failed|g_return_|has been already disposed"  # 1720
```

按家族分（跨 boot 总数）：`clutter_text_set_text` / `clutter_text_get_text` / `clutter_text_get_editable`
的 `CLUTTER_IS_TEXT (self)` 各 190（一次写挂三个，所以是 190 个事件），
`meta_window_set_stack_position_no_sync` 180，`pango_layout_get_cursor_pos` 164，
`St.Label … has been already disposed` 60，`g_object_unref: G_IS_OBJECT` 27。

**归因结论：这批不是本仓库的**，两条独立证据：本仓 shell 侧代码 `\.unref\(|g_object_unref`
命中 **0**（GJS 里对 null 调 unref 抛 TypeError，打不出 GLib 断言）；`has been already disposed`
附近栈帧按归属分组为 shell ui 1664 / Vitals 1590 / notification-grouper 159 / caffeine 105 /
blur-my-shell 8 / macos-dock 1，**copyous 0**。本轮 boot 里这五个家族 **0 条**，最近一次
`CLUTTER_IS_TEXT` 是 2026-10-09 13:22:16 —— 在那之前的 shell 里。

两个查询坑顺手记下：**大小写** —— `grep 'Assertion'` 数到 0，而消息体是小写 `assertion`；
**`grep -c` 计数为 0 时自己 exit 1**，会把 `&&` 链断在那里，别把"链断了"读成"这条查过了"。

`run.sh` 现在把第四、第五种都进闸门。断言行同 disposed 一样分**总数 / 6 行内出现本仓栈帧或
`Gjs_common_gjs_` / 无法归因**三档，只有中间那档判红：C 侧断言不带 JS 栈，硬把它们全算成自己的
就天天假红，而喊狼的闸门一周内会被关掉。合成日志上验过归因：纯外来 → `1 0`，紧跟本仓栈帧 →
`1 1`，混合 → `2 1`（2026-10-10，`assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL`）。


字段含义：

| 日志 | 含义 | 注意 |
| --- | --- | --- |
| `loaded N entries in Xms` | DB 查询本身 | 纯 I/O + 建行 |
| `filled N entries in Xms` | 注册 N 条 entry 并给窗口内的建 actor | **窗口化下这是最能反映收益的一条** |
| `warmup took Xms` | 启动期预热 | 窗口化下只热几个，不是全部 |
| `open(): show` | 打开到 `show()` 返回 | ⚠ 不能单独当判据，见本文「哪些数能当回归判据」 |
| `open(): pushModal` | 抢模态 | |
| `open(): TTI (main loop free)` | 主循环重新空闲 | **判回归看这个** |
| `open(): idle after redraw` | 重绘后空闲 | ⚠ 首开那次被渐进揭示的 gap 污染 |
| `page_size Ppx, N matching, M materialized` | 视口高 / **过滤后**条数 / 建了 actor 的条数 | 见下方"matching 不是总数" |
| `progressive reveal: ...` | 四段互斥账 `work + gap + pseudo + setup` | 窗口化下这条不该再出现 |

**`matching` 是过滤后的计数，不是库里的行数。** `exclude-pinned=true` 时它比行数少 pinned 的条数
（本机：255 行 − 5 pinned = `250 matching`）。这不是丢条目 —— 曾因此误报过一次，别重复查。

## 5. 哪些数能当回归判据，哪些不能

- **能**：`TTI (main loop free)`、`CRITICAL|JS ERROR` 计数、**`has been already disposed` 的
  copyous 可归因计数**（`run.sh` 末尾三条数：总数 / 可归因 / 外来；外来只报不判）、
  **C 侧 GLib 断言的本仓邻近计数**（第五种形态，同样三档）、
  `residentSetStaysBounded` 这类结构断言、01 的等价比对数与不一致数。
  ⚠ **旧版这里只写"CRITICAL 计数必须是 0"是不够的**：GJS 把访问已 dispose 对象打成 **warning**，
  `CRITICAL` 和 `JS ERROR` 两个词都不匹配。2026-10-09 那次 boot 实测：按旧判据数到 1 条（还是 dash.js 的），
  同期有 **12 条** disposed 警告从退出中的旧 shell 刷出，旧判据一条都看不见。
  归因靠两件事：栈帧里出现 `extensions/copyous@local/`，或消息头直接点名 `Gjs_common_gjs_<Class>`
  （本仓所有类都经 `lib/common/gjs.js` 注册，GType 名一律带这个前缀；外来的长这样：
  `Gjs_ui_layout_UiActor`、`Gjs_caffeine_patapon_info_extension_CaffeineToggle`）。
  **真实会话侧必须按 `_PID=` 过滤**，否则上一个 shell 退出时的清理噪声会算到本次头上。
- **不能**：`open(): show`。同一 boot 内实测散布 2.65×（337–895ms，n=6），冷开与暖开的相对关系还会在
  boot 之间翻转。一次代码回归不可能同时让冷路径变快又让暖路径变慢。
- **不能**：首开的 `idle after redraw`。它跑在 `PRIORITY_LOW(300)`，而揭示分片是
  `PRIORITY_DEFAULT_IDLE(200)`，必然先排空，所以那个数几乎等于 gap。
