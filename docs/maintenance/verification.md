# 三层验证：跑什么、按什么顺序、隔离边界在哪

改代码前后的验证入口全在这个文件：L0 静态、L0b 设置窗（**不用注销**）、L1 headless 三臂、L2 真实会话，外加隔离 harness 的硬边界、环境残留清理，以及「headless 能证明什么、不能证明什么」。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 1 节（L0/L0b/L1/L2）、第 3 节、第 10 节。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 1. 三层验证

### L0 静态（不需要 shell，永远先跑）

```sh
for f in $(find . -name '*.js' -not -path './.git/*'); do node --check "$f" || echo "FAIL $f"; done
node --test test/*.test.js          # `npm test` 现在也能跑（2026-10-09 实测），两种都行
```

预期：107 个文件全过；`tests 103 / pass 103 / fail 0`。
这两个数会随代码增长，别把它们当判据 —— 判据是 **fail 0**。要当场确认就跑
`find . -name '*.js' -not -path './.git/*' | wc -l` 和 `node --test test/*.test.js | grep -E '^# (tests|fail)'`。

**设置覆盖门**（schema ↔ 设置窗的交叉核对，纯静态、不碰 dconf）：

```sh
node scripts/settings-coverage.mjs   # 判据在最后一行：RESULT: PASS / FAIL
```

它把 `schemas/*.gschema.xml` 的 82 个键和 `lib/preferences/**` 的接线对齐，四种红法都已逐条投毒证明
会响：少一个 `makeResettable` 调用、把键名拼错、把 bind 的键名换成变量（这条同时封掉检测器唯一
的逃逸路径）、以及删掉 bind 却留着 reset 按钮。`test/settings-coverage.test.js` 把它接进了
`npm test`，所以漏掉一个恢复入口不可能靠"忘了跑那条命令"混过去。

`-- keys with no widget at all in prefs: 1` 是**已知且合法**的：`paste-on-copy` 已废弃，
`migrateSettings()` 把它的语义取反迁到 `swap-copy-shortcut` 再 `reset` 掉，所以它不该有行。
另有 2 个键（`in-memory-database`、`database-backend`）由按钮而非控件驱动，报告单列。

**接线一致性**（改名 / 删方法后必做）：

```sh
./test/headless/run.sh live 07          # 探针 07，一个会话约 1 分钟
```

这里原来写的是一条 `grep "\.addItem(\|\.focusChild(\|\.nextFocus("`，断言"预期：无输出"。
**它已经被证伪，别再照它跑**：容器重构删掉的 `addItem` 与 `SearchEntry` 自己的私有 `addItem`
（类型过滤下拉的建行函数）撞名，所以这条检查**永久误报 9 条**；而"已删方法名清单"这种形式本身
也会随代码演化腐烂——要么被忽略，要么被"删掉能跑的代码"来让它变绿。
（`SearchEntry` 的那个私有方法现已改名 `addFilterRow`，撞名消失；但守卫不该依赖改名。）

探针 07 换成**由代码自身推导范围**：从源码里取 `this._x = new Cls(` 与同文件内的 `this._x.m(`
配对，再把 `m` 解析到**活对象**上 —— 于是继承自 St/Clutter/GObject 的方法天然正确，不需要白名单；
取不到活实例的类别报成 `skipped` 而不是默默放过。2026-10-09 实测：83 文件 / 163 类声明 /
**135 个调用对** / 42 个活类 / 0 解析失败，9 组 skipped 全在 prefs 侧（设置窗是独立进程，
shell 里永远不会实例化它们）。对象遍历只进本仓库声明的类：不加这条限制时它死在
`Unsupported type GdaShort, deriving from fundamental gint` 上 —— 读 GI boxed 对象的属性会让
GJS 去 marshal 它表示不了的 GValue。探针自带一次故意投毒（同一解析器必须放过 `addEntry`、
必须抓住一个不存在的方法名），否则"0 失败"可能只是因为什么都没查。

### L0b 设置窗（**不需要注销，也不碰 dconf**）

`lib/preferences/**` 跑在独立的 gjs 进程里，所以它是唯一能「改完立刻验证」的面。
`test/prefs/run.sh` 在 Xvfb 下真建整棵 Adw 控件树，再对**它自己造出来的真控件**断言四条文案不变式
（外加 `windowBuilt` 这个前置条件，所以报告是 `# 5/5`）：

```sh
./test/prefs/run.sh                    # 判据在最后一行：green / RED / NOT VERIFIED
COPYOUS_PREFS_DUMP=1 ./test/prefs/run.sh | awk -F'\t' '$1=="ROW"'   # 逐行列出每个控件
COPYOUS_PREFS_ROOT=/tmp/lab/copyous@local ./test/prefs/run.sh        # 跑仓库副本（投毒用）
```

四条：每个分组有标题、**每个会改设置的行有副标题**、**每个纯图标按钮有 tooltip**、同一列表里
没有两行的 title+subtitle 完全相同。2026-10-09 第一次跑就是红的：6 个无标题分组、
**24/83 个设置行没有副标题**、**28/38 个纯图标按钮没有 tooltip**、Theme 页两行同名同副标题。

跑完之后还有一条**用户数据绊线**：这里只有 dconf 被 `GSETTINGS_BACKEND=memory` 隔离，数据目录用的是
真实路径，所以 `run.sh` 在跑前后各取一次指纹 —— `~/.config/copyous@local` 比 `ls -l | cksum`
（内容和元数据都不许变），`~/.local/share/copyous@local` **只比文件名集合**（日常使用会重写
`clipboard.db-wal`，比大小或 mtime 会把用户自己的剪贴板报成"测试写坏了数据"）。绊线本身是用
`HOME=/tmp/…` 的副本证明会响的，不是靠"没响"推出来的。

**恢复入口的覆盖不在这里查，在本文 L0 那节的静态门查**：`bind` 与 `makeResettable` 是同一文件的两处源码，
运行时看得到按钮、看不到它管哪个键。2026-10-09 补齐后实测：79 个控件全部有恢复按钮，
纯图标按钮 40 → 74 个（`edit-undo` 占绝大多数，都带同一个 tooltip）。

补这一轮时得到的两条经验：

- **绑在子页上的键，恢复按钮挂在打开它的那一行**。`file-preview-types` /
  `file-preview-exclusion-patterns` / `link-preview-exclusion-patterns` / `wmclass-exclusions`
  的 bind 目标是 `Adw.NavigationPage` 或 `Adw.PreferencesGroup`，它们**没有 `add_suffix`** —— 把
  `makeResettable` 挂上去，整个设置窗直接建不起来。投毒证明这条被 `windowBuilt` 抓住：
  `FAIL windowBuilt = row.add_suffix is not a function` + 到 `fileItemCustomization.js:214` 的栈。
- **按钮在默认值时是"灰着但可见"，不是隐藏**。隐藏更好看，但那样内存后端（整窗都在默认值）就
  一个按钮都数不到，运行时这道门会退化成空转；可见的灰按钮同时是"这项可以恢复"的提示。

三条边界，别把它们当成已覆盖：


- **只覆盖四个主页**。`window.push_subpage()` 推上去的子页（Default Actions / Manage
  Highlight.js / 声音选择器）和对话框里的控件**没有被走查** —— 它们不在窗口树上，直到被打开。
  实测判据：`ourPages=4`。
- **`Adw.Row` 不在 typelib 里**，`instanceof Adw.Row` 会当场抛异常。公开基类是
  `Adw.PreferencesRow`；`Adw.Range` 同理不存在。
- **纯图标按钮的判定必须排掉工具包自己画的**：`AdwSpinRow` 的 +/- 与下拉箭头不是我们的控件，
  给它们写 tooltip 是替 GTK 贴标签。排掉之后 60 → 37 个，剩下的才是我们的（`edit-undo` 那 26 个
  全部来自 `makeResettable` 一处，所以一行 tooltip 修掉 26 个缺口）。

仪器自己红过一次，值得记：`Gio.Application` **没有** `exit(code)`（只有私有 `g_application_exit`），
`activate` 又是同步返回的 —— 没有 `app.hold()` 时脚本在半路抛异常照样退出 0，`run.sh` 就打出
「green」。现在的三道锁：`hold/release` + `System.exit(code)` + **`run.sh` 找不到
`# N/M checks passed` 那行就判 NOT VERIFIED**，绝不从「没有红」推出「是绿」。

### L1 headless 三臂

```sh
./test/headless/run.sh all                  # 三配置 × 十三探针 = 39 个独立 shell 会话
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
| `05-windowed-cost` | 常驻集上界、RSS、滚动成本 —— **只报数不设闸**（见 [reading-the-log.md](reading-the-log.md) 与 [cost-measurement.md](cost-measurement.md)） |
| `06-ux-hidden` | 01-05 不看、但人会感觉出来的东西：按类型分解的建行成本、滚动是否触发 DB 写、动画聚焦是否反复建销、选中项会不会在还可见时被销毁、滚动条滑块尺寸是否稳定、pin 与 `exclude-pinned` 的交互、空历史状态 |
| `07-wiring` | 调用点对不对得上接收者的类：从源码推导 `this._x = new Cls(` + `this._x.m(`，把 `m` 解析到**活对象**上（取代原先那条永久误报的名字表 grep）。取不到活实例的类别记为 skipped 并打印出来，另含一次自我投毒证明它不是空转 |
| `08-permissions` | 落盘内容的权限：在 enable **之前**亲手造出"旧版本留下的残留"（`images/`、`languages/`、`backup/sub/`、cache、config 各带文件，全部投毒成 0775/0644，外加一个指向树外 0644 文件的 symlink），enable 之后断言三根之内全为 0700/0600、树外那个文件**没被**穿过链接改掉 |
| `09-cache-residue` | 搜索记忆表（内层 key 是**整条未截断的剪贴板内容**）是不是实例持有：从活对象取类再 `new` 一个 SearchEntry，必须是**空表且不是同一个 Map**；然后 `disable()` 必须把 `clipboardDialog` 放开。RSS 只报数不设闸（GJS 没有确定的回收点） |
| `10-notification-loopgap` | 复制图片时主线程被钉住多久：`send-notification` 由探针自己打开（默认 false，没有任何一臂覆盖这条分支），fixture 里那张 1728x1056 图由 `make-fixture.js` 写真文件。**比例只报数不设闸**（实测 1.3–1.57 波动 vs 旧代码 2.1），可判的闸门是确定性那条：路径含转义的 URI 必须还能解出预览与尺寸 —— 旧代码把 `file://` 剥掉后当成路径交给 GdkPixbuf，含空格的图片路径直接解码失败 |
| `11-grab-failure` | 抢模态被拒之后对话框的状态有没有收拾干净：`_updateCursor` 必须回到 true（否则 `show-at-pointer` 整会话失效）、modal 栈归零、被拒之后还能正常再开一次。**注入点只能是 `global.stage.grab`** —— `Main.pushModal` 是 `ui/main.js` 的具名导出，模块命名空间只读、改不了；而「先占住 SYSTEM_MODAL 再开」这条真实路线实测**不会被拒**（后到的请求拿走 grab，先前那个反而 `is_revoked()=true`），所以两种做法都跑一遍，真实那条只 `rec` 不 `chk` |
| `12-actions-config` | 一份能解析、但没有 `actions` 的 `actions.json` 会不会把条目菜单、动作快捷键和整个 Actions 页一起打死。四条腿：**先写自己的哨兵**（一个只有一行合法动作的文件）等菜单报出那个 id → 换 `{}` 等菜单**离开哨兵** → 再换回哨兵（证明守卫不是「一律返回默认值」）→ 还原原文件并等菜单同意。去掉守卫的副本 **FAIL 6/8**（`not-an-array:undefined` + 2 条 unhandled rejection + 1 条归属 copyous 的 disposed），修好的 **PASS 8/8** |
| `13-media-duration` | `gi://Gst` 唯一的服务对象：音频 File 条目上那个时长徽标。`make-fixture.js` 写一个 8kHz/16bit 的真 WAV（**名字带空格**，所以存进去的是 percent-encoded URI），期望时长**从文件自己的 RIFF 头算**（`dataSize / (rate * blockAlign)`），不是抄代码里的常量 —— 改长度不用改探针。窗口化下条目得先进视口，所以先按类型过滤成 5 条 File 行。十条腿含一条**负腿**：另一条非音频的 File 行不许长出时长控件（否则"切多了 case"也会绿灯）。2026-10-10 现场：`live 13` = **10/10**；把期望故意改成 +1 秒 → **FAIL 9/10** 并打印真实标签 `["48","48","KB","KB","3s","3s"]`，牙验过 |

### L2 真实会话（只读）

见 [reading-the-log.md](reading-the-log.md) 的 PID 取法 + [reading-the-log.md](reading-the-log.md) 的判读。

## 3. 隔离 headless shell 的边界

`test/headless/up.sh` 靠六件事保证不污染真实环境，改这个脚本时这几条都不能破：

1. **私有 dbus-daemon**（`$WORK/bus`），不是用户会话总线。
2. **`GSETTINGS_BACKEND=memory`** —— 读 schema 默认值，所有写入丢弃，真实 dconf 一个字节都不动。
   它是**按进程**的，所以设置只能在 Eval 内部写，在外层 shell 里 `gsettings set` 对它无效。
3. **`XDG_DATA_HOME=$WORK/xdg`**：扩展本体用 **symlink**（这样磁盘上的编辑会被加载），
   app-data（`highlight.min.js`、`languages/`）用 **`cp -a` 复制**。symlink app-data 会让第二个
   shell 写进真实的 `~/.local/share/copyous@local`。
4. **`XDG_CACHE_HOME=$WORK/xdg-cache`**（空目录，cache 可再生）与
   **`XDG_CONFIG_HOME=$WORK/xdg-config`**（把真实 `~/.config/*` 逐个 symlink 进来，唯独
   `copyous@local` 是**真目录** + `cp -a` 的 `actions.json`）。这两条是 `makeStoredPrivate()`
   逼出来的：它每次 enable 会 chmod 这三根，不隔离的话"跑一次探针"就顺手改了用户真实目录的权限。
   config 用 symlink 农场而不是全新空目录，是为了让第二个 shell 看到的其余配置与真实会话一致。
   ⚠ `copyous@local` 必须先跳过再建真目录 —— 先 symlink 它，`mkdir -p` 会变成对链接的空操作，
   下面的 `cp -a` 就直接写进 `~/.config`（实测踩过，报 "are the same file"）。
5. **`DEBUG_COPYOUS_DBPATH=$WORK/session.db`** —— 每个会话一份 fixture 拷贝，真实
   `clipboard.db` 永不被打开。直接指向 `fixture.db` 会让探针的删除/改时间戳磨掉种子行数
   （255→250），重跑不再幂等。
6. 会话库的父目录（`$WORK`）会被 `gda.js` 的启动收紧改成 0700：所有者权限不受影响，
   但别指望它是 0775。

fixture 由 `make-fixture.js` 生成，与真实库同构（255 行 / 5 pinned / 6 种 type 分布），
因为多条断言是对行数做算术（窗口化下滚动范围必须精确等于 `n*itemExtent + (n-1)*spacing`）。
规模变了，断言就要跟着改。

**探针的三条硬规矩**（都踩过）：

- 绝不用 `file://` URI 去 `import` 扩展模块。那会加载第二份模块图并重复注册 GType，扩展直接以
  `Type name Gjs_common_gjs_JsObjectWrapper is already registered` 起不来。类要从活对象上取
  （见 `_preamble.js` 里 `Object.getPrototypeOf(...searchQuery).constructor`）。
- 绝不读已销毁 actor 的属性，`get_parent()` 也算。GJS 打的是 CRITICAL 警告不是 JS 异常，
  `try/catch` 拦不住，会让一次干净的运行看起来坏了。
- **不要在同一个会话里二次 enable。** harness 是绕过扩展管理器直接 `_callExtensionInit` +
  `_callExtensionEnable` 的，管理器的状态从没变成过 ENABLED，所以 `disableExtension()` 是空操作，
  第二次 enable 会撞 `Extension point conflict: there is already a status indicator for role
  copyous@local`，然后填充拿到 0 条（2026-10-09 探针 09 第一版就是这么红的 —— **红的是探针，不是产品**）。
  要证明"东西是实例持有、不是模块持有"，用**活对象取类再 new 一个实例**比对身份（探针 09 现在的做法）。
- **异步生效的投毒要等「离开自己写的哨兵」，不是等「变成预期值」。** 探针 12 第一版写完 `{}` 之后
  问「actions 还是数组吗」，旧代码照样答是 —— 因为改动还没落地，读到的是**上一份好配置**，于是把
  去掉守卫的副本测成 7/7 全绿。现在每条腿都以「我先写进去的那个可辨识值」为锚点等它变化，等不到就
  超时判红。**green 必须是等出来的，不是睡出来的。**

## 10. headless 能证明什么、不能证明什么

**能**：语义等价（01）、结构与生命周期不变量（02/03）、extent 精确性与窗口化行为（04）、
常驻集规模与相对成本（05）、CRITICAL / JS ERROR 的存在与否。

**不能**：

- 它用 memory settings backend，**不等于**你的真实 dconf。配置差异靠 `configs/*.json` 显式建模，
  不靠"应该差不多"。
- 虚拟 monitor 是 1280x800，`page_size` 实测 378px；真实会话是 535px。所以**窗口大小、每屏条目数
  这类结论必须标注来自哪一臂**，跨臂比较没有意义。
- 它测不到 swap 压力。本机最初诊断出的"898MB 被换出 → major fault 风暴"是真实会话特有的，
  headless 只能证明"不再分配那么多"，证不了"因此不卡"。后者要 [baseline.md](baseline.md) 的 live 数字。
- fixture 是合成的。文件条目指向**不存在**的路径 —— 这其实是好事：正是它暴露了
  `FileItem.configureFilePreview()` 在 await 之后不检查 cancellation、条目被销毁后继续写
  已 dispose 的 `St.Label` 这个竞态（窗口化把销毁从"偶尔"变成"滚动时持续发生"）。
