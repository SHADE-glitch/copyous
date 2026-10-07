# copyous@local 维护清单

本仓库是上游 [Copyous](https://github.com/boerdereinar/copyous) 2.0.1 冻结后的本地维护分支，
没有构建步骤，直接从 `~/.local/share/gnome-shell/extensions/copyous@local` 运行。

这份文件只回答三个问题：**改之前跑什么、日志怎么读、哪些东西别碰。**
"改了什么、为什么改"看 [README.zh-CN.md](README.zh-CN.md#-相对上游的改动201) 的分歧清单（权威）；
给 agent 的硬规则看 [AGENTS.md](AGENTS.md)。三处不重复，避免漂移。

---

## 0. 三十秒速查

| 我要做的事 | 先跑 |
| --- | --- |
| 改了 `lib/common/{color,glob,settings}.js` 或 `lib/misc/actor.js` | `npm test`（秒级，不需要 shell） |
| 改了任何 `lib/ui/**`、`extension.js` | `./test/headless/run.sh live`（分钟级，会抢 CPU） |
| 改了滚动 / 过滤 / 焦点相关 | `./test/headless/run.sh all`（三臂全跑） |
| 想确认某个性能结论在真实会话成立 | 注销登录 → 见 §5 的 PID 取法 → 读 journal |
| 怀疑有残留进程在干扰测量 | `./test/headless/down.sh` |

---

## 1. 三层验证

### L0 静态（不需要 shell，永远先跑）

```sh
for f in $(find . -name '*.js' -not -path './.git/*'); do node --check "$f" || echo "FAIL $f"; done
node --test test/*.test.js          # 或 npm test，但 npm 在本机被沙箱拦，直接用 node
```

预期：89 个文件全过；`tests 100 / pass 100 / fail 0`。

**接线审计**（改名/删方法后必做，这类 bug 探针抓不到、只有 grep 抓得到）：

```sh
grep -rn --include='*.js' "\.addItem(\|\.focusChild(\|\.nextFocus(" . | grep -v test/
```

预期：无输出。容器重构删过这三个方法，留着调用点就是运行时 `TypeError`。

### L1 headless 三臂

```sh
./test/headless/run.sh all                  # 三配置 × 五探针 = 15 个独立 shell 会话
./test/headless/run.sh live                 # 只跑当前真实配置那一臂
./test/headless/run.sh unwindowed 01 03     # 只跑两个探针
```

三臂分别是：

| config | 覆盖什么 | 为什么必须留 |
| --- | --- | --- |
| `live` | 竖向 + 固定 170px 行 → **窗口化生效** | 你机器上实际跑的就是这条 |
| `unwindowed` | 竖向 + 动态行高 → **窗口化关闭**，每条都有 actor | 它离 `live` 只有一个设置的距离，必须同样绿 |
| `horizontal` | 横向 + 固定宽 → 窗口化生效 | 全新安装的默认臂 |

每个探针独占一个 shell 会话。**不要**为了省时间把它们塞进同一会话：前一个探针的开开关、搜索、
销毁会渗进后一个探针的计时和内存里 —— 有一次 6× 的填充改善就是这么被读成"没变化"的。

结果落在 `$COPYOUS_WORK/out`（默认 `/tmp/copyous-harness/out`），不进仓库，所以没有需要
gitignore 的产物；崩溃了产物也还在 `/tmp` 里可查。

探针清单：

| 探针 | 判什么 |
| --- | --- |
| `01-search-equivalence` | entry 层过滤与**已删除的**逐类型 `search()` 覆写是否逐条等价（参照实现抄在文件里）。对 `_entries` 全量比对，不对 actor 比对 |
| `02-lifecycle-modal` | 开/关/动画中途重开/快速连开关后 `modalActorFocusStack` 归零；索引导航；无匹配占位 |
| `03-container-invariants` | `_entries` 有序、actor 镜像 `_filtered` 的正确切片、Home/End/Tab、内容改判焦点交接、live copy、删除、改时间戳重排 |
| `04-windowed-structure` | 窗口化的 extent A/B、滚动对齐、焦点出窗与恢复、搜索窗口化、删除/重排 |
| `05-windowed-cost` | 常驻集上界、RSS、滚动成本 —— **只报数不设闸**（见 §5） |
| `06-ux-hidden` | 01-05 不看、但人会感觉出来的东西：按类型分解的建行成本、滚动是否触发 DB 写、动画聚焦是否反复建销、选中项会不会在还可见时被销毁、滚动条滑块尺寸是否稳定、pin 与 `exclude-pinned` 的交互、空历史状态 |

### L2 真实会话（只读）

见 §4 的 PID 取法 + §5 的判读。

---

## 2. 代码加载规则（最容易自欺的一条）

`gnome-extensions disable && enable` **不会**重新 import 任何 `lib/*.js`。GJS 按 `file://` URI
缓存 ESModule，整个 shell 生命周期内不失效，Wayland 上也没有 `--replace`。

所以：**改完代码，不注销登录，journal 里看到的就是旧行为。** 不要据此判断"改动没效果"或
"改动没生效"。要么注销登录，要么用 `test/headless/`（它每次起新进程，加载的是磁盘上的当前内容）。

---

## 3. 隔离 headless shell 的边界

`test/headless/up.sh` 靠四件事保证不污染真实环境，改这个脚本时四条都不能破：

1. **私有 dbus-daemon**（`$WORK/bus`），不是用户会话总线。
2. **`GSETTINGS_BACKEND=memory`** —— 读 schema 默认值，所有写入丢弃，真实 dconf 一个字节都不动。
   它是**按进程**的，所以设置只能在 Eval 内部写，在外层 shell 里 `gsettings set` 对它无效。
3. **`XDG_DATA_HOME=$WORK/xdg`**：扩展本体用 **symlink**（这样磁盘上的编辑会被加载），
   app-data（`highlight.min.js`、`languages/`）用 **`cp -a` 复制**。symlink app-data 会让第二个
   shell 写进真实的 `~/.local/share/copyous@local`。
4. **`DEBUG_COPYOUS_DBPATH=$WORK/fixture/fixture.db`** —— 合成数据，真实 `clipboard.db` 永不被打开。

fixture 由 `make-fixture.js` 生成，与真实库同构（255 行 / 5 pinned / 6 种 type 分布），
因为多条断言是对行数做算术（窗口化下滚动范围必须精确等于 `n*itemExtent + (n-1)*spacing`）。
规模变了，断言就要跟着改。

**探针的两条硬规矩**（都踩过）：

- 绝不用 `file://` URI 去 `import` 扩展模块。那会加载第二份模块图并重复注册 GType，扩展直接以
  `Type name Gjs_common_gjs_JsObjectWrapper is already registered` 起不来。类要从活对象上取
  （见 `_preamble.js` 里 `Object.getPrototypeOf(...searchQuery).constructor`）。
- 绝不读已销毁 actor 的属性，`get_parent()` 也算。GJS 打的是 CRITICAL 警告不是 JS 异常，
  `try/catch` 拦不住，会让一次干净的运行看起来坏了。

---

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

```sh
LOG='journalctl --no-pager -o cat'
$LOG /usr/bin/gnome-shell | grep -a '\[timing\]'          # 全部计时
$LOG /usr/bin/gnome-shell | grep -acE 'CRITICAL|JS ERROR'  # 必须是 0
grep -E '^(Rss|Swap)' /proc/<pid>/smaps_rollup             # 常驻 / 被换出
awk '{print $12}' /proc/<pid>/stat                          # majflt
```

字段含义：

| 日志 | 含义 | 注意 |
| --- | --- | --- |
| `loaded N entries in Xms` | DB 查询本身 | 纯 I/O + 建行 |
| `filled N entries in Xms` | 注册 N 条 entry 并给窗口内的建 actor | **窗口化下这是最能反映收益的一条** |
| `warmup took Xms` | 启动期预热 | 窗口化下只热几个，不是全部 |
| `open(): show` | 打开到 `show()` 返回 | ⚠ 不能单独当判据，见 §5 |
| `open(): pushModal` | 抢模态 | |
| `open(): TTI (main loop free)` | 主循环重新空闲 | **判回归看这个** |
| `open(): idle after redraw` | 重绘后空闲 | ⚠ 首开那次被渐进揭示的 gap 污染 |
| `page_size Ppx, N matching, M materialized` | 视口高 / **过滤后**条数 / 建了 actor 的条数 | 见下方"matching 不是总数" |
| `progressive reveal: ...` | 四段互斥账 `work + gap + pseudo + setup` | 窗口化下这条不该再出现 |

**`matching` 是过滤后的计数，不是库里的行数。** `exclude-pinned=true` 时它比行数少 pinned 的条数
（本机：255 行 − 5 pinned = `250 matching`）。这不是丢条目 —— 曾因此误报过一次，别重复查。

---

## 5. 哪些数能当回归判据，哪些不能

- **能**：`TTI (main loop free)`、`CRITICAL|JS ERROR` 计数、`residentSetStaysBounded` 这类结构断言、
  01 的等价比对数与不一致数。
- **不能**：`open(): show`。同一 boot 内实测散布 2.65×（337–895ms，n=6），冷开与暖开的相对关系还会在
  boot 之间翻转。一次代码回归不可能同时让冷路径变快又让暖路径变慢。
- **不能**：首开的 `idle after redraw`。它跑在 `PRIORITY_LOW(300)`，而揭示分片是
  `PRIORITY_DEFAULT_IDLE(200)`，必然先排空，所以那个数几乎等于 gap。
- **不能**：RSS 的绝对值。glibc 不把释放掉的 GJS 内存还给 OS，RSS 是**高水位**，走完整个列表后
  不会回落。窗口化赢在"正常使用时到不了那个水位"，不赢在回收。
- **滚动成本只报数不设闸**：每跨一屏中位 ~18ms 是窗口化的**代价**（销毁+重建约 2 个 item），
  不是回归。写进阈值会把一个已知的好交易变成红灯。一屏 overscan 以内的小滚动仍是零成本。

判一次真实回归的代价：需要注销登录。别指望 disable/enable。

---

## 6. 窗口化：门控、旋钮、以及会静默关掉它的东西

`ClipboardScrollContainer._materialized()` 只在**滚动轴上 item 尺寸均匀**时收窄窗口：

```
windowable = orientation != VERTICAL || !dynamic-item-height
```

所以：

- **`dynamic-item-height` 是窗口化的实际开关**（竖向时）。关掉 → 常驻 actor 从 255 降到 7–16；
  打开 → 完全退回旧行为，两条路径都有探针覆盖（`live` vs `unwindowed`）。
- **`item-height` 和 `clipboard-size` 是即时旋钮**，改它们**不需要**注销登录：
  `updateSize()` 监听 `changed::item-height`，容器也监听它做 `_syncWindow(true)` 重算窗口和 spacer。
  密度不够就先降 `item-height`（范围 50–1000），或升 `clipboard-size`（弹窗尺寸）。
  窗口化的 extent 用的是当前值，所以任何 `item-height` 下都精确。
- ⚠ **偏好设置里的 "Compact" 预设会把 `dynamic-item-height` 设回 `true`**
  （`lib/preferences/customization/profiles.js`），窗口化收益会**无声消失**。
  排查"怎么又卡了"，第一件事是 `dconf read /org/gnome/shell/extensions/copyous/dynamic-item-height`。
- 焦点条目滑出窗口时，key focus 交还搜索框，但 `_focusEntry` 保留 —— 下一次方向键会把它重新
  materialize 并滚回去。选中位置不丢，这是设计，不是 bug。

---

## 7. 数据库纪律

- live DB：`~/.local/share/copyous@local/clipboard.db`（WAL 模式，另有 `-wal` / `-shm`）。
- **任何涉及 DB 的改动之前先备份**到 `~/.local/share/copyous@local/backup/`，命名
  `clipboard-prediag-<YYYYMMDD-HHMMSS>.db`，备份后跑一次 `PRAGMA integrity_check`。
- 只读查询一律用 URI 形式带 `mode=ro`，避免误触发 checkpoint：
  ```sh
  sqlite3 "file:$HOME/.local/share/copyous@local/clipboard.db?mode=ro" 'select count(*) from clipboard;'
  ```
  表名是 `clipboard`（不是 `entries`），有 `UNIQUE(type, content)` 约束 —— 它就是去重机制，
  批量造数据时撞它是正常的。
- `.gitignore` 已排除 `*.db*`。仓库根可能有个 0 字节的 `clipboard.db` 残留（来自
  `DEBUG_COPYOUS_DBPATH` 未生效的旧运行），无害，别去提交它。
- headless 永远走 fixture，**绝不**把 `DEBUG_COPYOUS_DBPATH` 指向 live DB。

---

## 8. GNOME 大版本升级检查单

上游冻结在 2.0.1，所以每一次 GNOME 大版本升级都是这里的事：

1. `metadata.json` 的 `shell-version` 目前是 `["48","49","50"]`。**不改它，扩展在新 shell 上直接不加载。**
   这是有意的安全闸（宁可不加载也不要半死不活地跑），但升级时必须主动加进去。
2. ABI 库名：GNOME 50 是 `libshell-18.so`（不是 `libgnome-shell.so`）。要抄 shell 内部实现时用
   `gresource extract /usr/lib/gnome-shell/libshell-18.so /org/gnome/shell/ui/<file>.js`。
3. `Math.clamp` 不是 JS 内置，由 shell 注入。`lib/common/color.js` 依赖它，所以
   `test/color.test.js` 里装了 shim；新增能跑在 Node 下的测试时要同一个 shim。
4. `theme.gresource` 与 `resources.gresource` 是**编译产物且有意提交**（本仓库没有构建步骤），
   而**仓库里没有 CSS 源码**。任何视觉改动都等于引入构建链 —— 那是不允许的。
   能读不能改：`gresource list theme.gresource` → `gresource extract theme.gresource <path>`
   （子命令是 `extract`，没有 `show`）。
5. 升级后第一件事是 `./test/headless/run.sh all`，因为 `--headless` / `--unsafe-mode` /
   `--virtual-monitor` 这三个 flag 的行为一变，整套验证就静默失效。`up.sh` 会打印它们。

---

## 9. 环境残留清理

`run.sh` 用 `trap` 收尾，但崩溃或被外部杀掉时会留下一个占 ~230MB 的 headless shell，
而它会让 §4 的 PID 取法读到错的进程。

```sh
./test/headless/down.sh          # 幂等，按 pidfile + 特征串清
pgrep -af "wayland-copyous-harness"   # 应该是空的
```

---

## 10. headless 能证明什么、不能证明什么

**能**：语义等价（01）、结构与生命周期不变量（02/03）、extent 精确性与窗口化行为（04）、
常驻集规模与相对成本（05）、CRITICAL / JS ERROR 的存在与否。

**不能**：

- 它用 memory settings backend，**不等于**你的真实 dconf。配置差异靠 `configs/*.json` 显式建模，
  不靠"应该差不多"。
- 虚拟 monitor 是 1280x800，`page_size` 实测 378px；真实会话是 535px。所以**窗口大小、每屏条目数
  这类结论必须标注来自哪一臂**，跨臂比较没有意义。
- 它测不到 swap 压力。本机最初诊断出的"898MB 被换出 → major fault 风暴"是真实会话特有的，
  headless 只能证明"不再分配那么多"，证不了"因此不卡"。后者要 §5 的 live 数字。
- fixture 是合成的。文件条目指向**不存在**的路径 —— 这其实是好事：正是它暴露了
  `FileItem.configureFilePreview()` 在 await 之后不检查 cancellation、条目被销毁后继续写
  已 dispose 的 `St.Label` 这个竞态（窗口化把销毁从"偶尔"变成"滚动时持续发生"）。

---

## 11. 当前基线

**2026-10-07 更新 · 六探针三臂 18 个会话全跑：17 PASS + 1 正确 SKIP，0 条 CRITICAL / JS ERROR。**
（上一轮 2026-10-01 是五个探针 15 个会话，同一套结论，`39c5ea8` + 取消竞态修复。）

### L1 headless（fixture：255 行 / 5 pinned / `exclude-pinned` 下 250 可见）

| 指标 | `live`（窗口化） | `unwindowed` | `horizontal`（窗口化） |
| --- | ---: | ---: | ---: |
| 填充后常驻 actor | 3 | 255 | 3 |
| 走完全列表的常驻峰值 | 10 | 255 | 16 |
| 填充后 RSS | 254 MB | 319 MB | 251 MB |
| 走完 + 回顶后 RSS | 291 MB | 379 MB | 289 MB |
| 滚动一屏中位 | 20.2 ms | 1.4 ms | 28.7 ms |
| 滚动一屏最差 | 181.4 ms | 2.5 ms | 185.4 ms |
| extent 容差 | 0 px（精确） | n/a | 30 px（已知，见 §12） |
| 探针结果 | 5/5 PASS | 4 PASS + 1 SKIP | 5/5 PASS |

extent A/B（同一会话内强制全量再收回，唯一变量是 actor 数）：竖向 `upper` 恒为 **46398** =
255×170 + 254×12，七个滚动位置全一致；RSS 在全量峰值 377 MB，收回窗口后 359 MB。
**能回落一点，但别把 RSS 当活集用**（§5）。

搜索等价：每臂 6630 次全量比对 + 2550 次增量比对，**0 不一致**。

### L2 真实会话（2026-10-07 22:01 登录，PID 101341）

```
loaded 255 entries in 371.126ms
filled 255 entries in 151.381ms      ← 窗口化前同机同库：1262 / 1390 / 1422 / 1434ms
warmup took 11.688ms
shell: Rss 359MB  Swap 24MB  majflt 60     全机 swap: 599MB / 15258MB
本会话 CRITICAL/JS ERROR: 1 条，且是别的扩展的 firstIcon（跨 boot 已出现 11 次），
                          与本仓库无关；竞态特征（line_wrap / already disposed）0 条。
```

对照 2026-10-01 那个**未窗口化**的会话：`filled 1262–1434ms`、`Rss 570MB`、`Swap 915MB`、
`majflt 133176`、全机 swap 9312MB。**会话年龄不同（19 分钟 vs 数天），这组对比只能当方向看，
不能当判据**（§5）。真实会话 `page_size` 是 535px，headless 是 378px，所以每屏条目数与
窗口大小两边不可比。

### 体验面（probe 06，两次独立运行数值一致）

窗口化把**建行成本从启动搬到了滚动路径上**。这是本轮量出来的最大一项，也是唯一一项用户能
直接感觉到的代价：

| | 窗口化（`live`） | 未窗口化（`unwindowed`） |
| --- | ---: | ---: |
| 一整趟滚动新建行数 | ~83 步 × 每步 2 行 | 0（全在填充时建好了） |
| 一整趟的建行耗时 | **~1000 ms** | 0 ms |
| 单步最差 | **182–190 ms** | 1.5–2.5 ms |

按类型分解建行耗时（每类型独立统计，两次运行一致）：

| 类型 | 建行次数 | 均值 | 最差 |
| --- | ---: | ---: | ---: |
| Text | 498 | 3.0 ms | 7.1 ms |
| **Code** | 195 | **7.4 ms** | **121.6 ms** |
| Link | 9 | 4.5 ms | 9.4 ms |
| Image / File / Files | 45 | 3.3–3.6 ms | ≤ 6.0 ms |

**Code 行的均值是 Text 的 2.4 倍，最差单次 121–133 ms（约 7 帧）**。所以"滚过一段代码历史时
顿一下"是真实存在的，不是错觉；未窗口化时同样的成本发生在启动填充里，人不觉得。
缓解方向（都还没做，等定）：给 Code 行单独加大 overscan、或把高亮推迟到绘制之后。

其余六项**都是好消息，说明没有隐藏的体验问题**：

- **滚动期间 DB 写 0 次**（三臂一致）。曾担心 `CodeItem` 惰性探测语言 → `notify::metadata` →
  `updateProperty` 会把写库挪到滚动时，实测没有发生。
- **选中项从不在还可见时被销毁**：窗口是 `[first-rows, first+2·rows+1)`，可见行是
  `[first, first+rows]`，四轴 × 每轴 7 个视口位置逐一验证，0 例。
- **一次动画聚焦建行 0 个** —— 不反复建了再扔。
- **滚动条滑块尺寸竖向完全恒定**（相对散布 0%）；横向 0.026%，即 24px 滑块上 0.006px，
  来自 §12 那条已知的 15px/端 extent 偏差。
- **pin 一行不会让它当场消失**（`notify::pinned` 不触发重过滤）。但注意：`exclude-pinned=true`
  下它会在**下一次搜索按键时**消失 —— 这是上游行为，不是本分支引入，用户可能觉得意外。
- 空历史（新装机的初始态）正常：显示 Empty 态、0 建行、无游离子节点。
- **RSS 会随滚动趟数上涨，但窗口化涨得更少**：三趟全列表下来，窗口化 290→296→314MB
  （+24MB），未窗口化 391→416→437MB（+46MB，且起点就高 100MB）。所以"反复滚动会不会把内存
  越滚越大"这个担心，方向上是反的 —— 未窗口化那条也在涨，而且涨得更多。


### 这套验证抓到过什么（留证，说明它值这个维护成本）

- **`FileItem` / `LinkItem` 的 await-之后-写已销毁 actor 竞态**：`configureFilePreview()` 在
  `await getFileType()` / `await tryCreateFilePreview()` 之后不检查 `_cancellable`，直接
  `insert_child_above` 并调 `configureVisibility()`，而后者写 `this._file.clutter_text.line_wrap`
  —— label 已 dispose，`clutter_text` 为 null，抛 `TypeError` 并刷一串 `St.Label … has been
  already disposed`。`LinkItem` 的 `await tryGetMetadata()` 之后同样裸写
  `this._linkPreview.metadata`。`destroy()` 早就 `cancel()` 了，只是没人查。
  **这是窗口化把一个原本只在清空/删除时偶尔发生的竞态，变成了滚动与搜索时持续发生** ——
  首轮 9 条 CRITICAL，加守卫后 0 条。
- harness 自身的两个坑：探针里用 `Math.round` 而代码用 `Math.ceil` 算视口数，阈值差一屏就假红；
  以及 fixture.db 被当会话库直接用，15 个会话把行数从 255 磨到 250，重跑不再幂等。


## 12. 已知不修 / 待确认

不在这里重复，指针：

- 有意未修的分歧点与理由 → [README.zh-CN.md](README.zh-CN.md#已知但有意未修的分歧点)
  （含横向列表 15px/端的 extent 偏差、`deleteOldest` 的字符串手术、`highlightAuto` 切片长度等）
- 给 agent 的硬规则（不许 rebase / 不许改 uuid / 不许引入构建链 / 提交规范）→ [AGENTS.md](AGENTS.md)
