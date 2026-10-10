# CHANGELOG — copyous@local

Personal maintenance fork of [Copyous](https://github.com/boerdereinar/copyous) upstream 2.0.1,
imported frozen at `335fff2`. This file records only deviations I introduced after that import.

Coverage: 335fff2..HEAD
Check with `npm run check:log`. Entries are `D-###`, monotonic, never reused.
An entry states what was true **as of its commit**, not current state: old entries are not
re-verified, and aggregate counts live in the checker's output, never in this file.

> **How these were written.** D-001..D-029 are a backfill: `Symptom` / `Change` are compressed from
> the commit subject plus the state of the touched file at HEAD, and the diffs were not re-read one
> by one. D-030 onward were written from the commit body and the diff of the same session, which is
> why their `Evidence` names real runs. Treat any entry as an index into its commit. `Evidence`
> names a test only where that suite was re-run in the session that wrote the entry; `L?` on
> purpose where it was not.

`kind` here uses six values: `fix` / `perf` / `taste` / `guard` / `revert` / `chore`. `perf` is separated
from `fix` because most of this fork's work is resource and throughput work — dropping it
re-introduces measurable degradation but not a correctness bug, and an upgrade needs to know which
is which. `chore` is the residue that owes nothing in either direction (dead code removed, a comment
corrected, a document relocated), so it must be distinguishable from `taste` at upgrade time.

The last field of a heading is the release it belongs to: `v9` is the value `metadata.json`'s
`version` held when the entry was written. It is not a verification tier -- those are the `L0` /
`L0b` / `L1` / `L2` prefixes inside `Evidence`.

---

### D-001 · 2026-09-22 · perf · v9
Symptom  Gda 5 后端下轮询间隔固定，空闲时也在轮询
Change   自适应轮询
Evidence L?
Cost     轮询节奏是观感与空转的折中，改它要先量再改
Commit   a30ac0e

### D-002 · 2026-09-22 · fix · v9
Symptom  修剪历史时不判断是否真能挤出条目，会删掉不该删的条目
Change   仅在有条目可淘汰时才修剪
Evidence L?
Cost     这条守的是用户数据，不是性能；回归表现为"历史莫名变短"
Commit   6ba6862

### D-003 · 2026-09-22 · perf · v9
Symptom  默认 journal 模式 + `synchronous=FULL`，每次写入都同步落盘
Change   改 WAL + `synchronous=NORMAL`
Evidence L?
Cost     **这是耐久性与吞吐的交换**：断电/崩溃时最后若干事务可能丢失。升级时不要当纯优化看待
Commit   16cbbd3

### D-004 · 2026-09-22 · fix · v9
Symptom  `actions.json` 的文件监视守卫在两处使用点上判定不一致，一边受保护一边不受
Change   两处统一到同一守卫
Evidence L?
Cost     两用户点必须同批改，单边改等于没修
Commit   610e242

### D-005 · 2026-09-22 · perf · v9
Symptom  搜索热路径每次都新建 collator 并逐条比较
Change   memoize `localeContains`，把 collator 调用提到循环外
Evidence L?
Cost     缓存键必须覆盖语言环境，否则换 locale 后结果会陈旧
Commit   040dcb7

### D-006 · 2026-09-22 · fix · v9
Symptom  每次 enable/disable 循环都泄漏一批资源，长时间会话里单调增长
Change   释放 enable 期申请的资源
Evidence L?
Cost     与 D-007、D-014 同一条销毁链，改动要整链看
Commit   7283fb8

### D-007 · 2026-09-22 · fix · v9
Symptom  异步初始化在 `disable()` 之后仍然续体落地，写回已经不存在的状态
Change   丢弃活过了 disable 的异步初始工作
Evidence L?
Cost     取消判定必须带"我是哪一代"的标记，光判 `this._enabled` 会漏
Commit   ad5cb9f

### D-008 · 2026-09-22 · perf · v9
Symptom  启动期对大量路径做存在性扫描
Change   减少启动期文件探测
Evidence L?
Cost     少探测意味着有些错误要晚一点才暴露，改动要保住可诊断性
Commit   8e158b3

### D-009 · 2026-09-22 · perf · v9
Symptom  代码片段识别被重复执行多次
Change   去重自动识别
Evidence L?
Cost     与 D-005 同在启动/搜索热路径
Commit   51e65ba

### D-010 · 2026-09-23 · perf · v9
Symptom  动作正则每次调用重新编译；对话框打开耗时未知
Change   缓存动作正则，并给 dialog open 计时
Evidence L?
Cost     计时部分是观测面，行为部分是缓存——同批但判据不同
Commit   0c463b2

### D-011 · 2026-09-23 · fix · v9
Symptom  公共目录推导走错，返回不该返回的目录
Change   修正 common-directory walk
Evidence L?
Cost     从 D-010 那笔里单独回滚时，别把缓存一起滚掉
Commit   0c463b2

### D-012 · 2026-09-23 · fix · v9
Symptom  Gda 查询用字符串拼接，条目内容直接进入语句（用户剪贴板内容不可信）
Change   全部参数化，并顺带做正确性/性能/清理一轮
Evidence L?
Cost     **注入面**，不是风格问题。后续任何"方便起见"拼字符串的改动都要按回归对待
Commit   5f1f63e

### D-013 · 2026-09-23 · fix · v9
Symptom  modal grab 抢走弹窗的键盘焦点；另有一处 `focusChild` 拼写错误使恢复不生效
Change   恢复弹窗键盘焦点并修正拼写
Evidence L0 本轮重跑 `npm test`（100 pass / 0 fail；该套件覆盖 actor 可见性与焦点辅助原语）
Cost     焦点路径无头难以端到端证明，L2 未验证
Commit   9e32688

### D-014 · 2026-09-24 · fix · v9
Symptom  条目移除时不 `destroy`，销毁链有缺口；启动期存在竞态
Change   补齐销毁链并修启动期竞态
Evidence L?
Cost     与 D-006 / D-007 同一条链；这条是那次"维护基线"提交的行为半边
Commit   f0761fe

### D-015 · 2026-09-24 · guard · v9
Symptom  打开链路没有 TTI 埋点，"慢"无法归因
Change   给 open 路径加 TTI 埋点（同笔提交的另一半见 D-014）
Evidence L?
Cost     埋点不改变行为；它违反"绿了还看不见"的那类盲区，删掉等于把可观测面关掉
Commit   f0761fe

### D-016 · 2026-09-25 · guard · v9
Symptom  渐进揭示的埋点把 work 与 gap 混在一起，实测首开 6567ms 里 95.5% 其实是 idle 等待
Change   拆分 work / gap 两个埋点
Evidence L?
Cost     合并回一个计数就会重新出现"把等待当成本"的误读
Commit   7df1fee

### D-017 · 2026-09-28 · fix · v9
Symptom  `color.js` 有 4 个缺陷（构造钳制、hue 归一化、命名色与 hex 解析）
Change   修 4 处并补上本仓第一个测试套件
Evidence L0 本轮重跑 `npm test`：`constructor clamping` / `hue normalization` /
         `parse: named colors` / `parse: hex` 等 describe 块在 100 个用例内
Cost     测试与被修的是同一件事，回滚修复会立刻把套件弄红
Commit   4860c24

### D-018 · 2026-09-28 · fix · v9
Symptom  glob 的 `[!...]` 取反类在 `]` 作为首字符时翻译错误
Change   修正翻译并补 glob 单测
Evidence L0 本轮重跑 `npm test`（glob 套件）
Cost     边界字符类是典型的"看起来没问题"分支，改动必须有对应用例
Commit   c51e620

### D-019 · 2026-09-28 · guard · v9
Symptom  `open(): show` 缺内容构成信息，慢的时候不知道慢在哪一层
Change   增加只读内容构成埋点
Evidence L?
Cost     只读埋点；不许顺手变成写状态
Commit   e9bc801

### D-020 · 2026-09-28 · guard · v9
Symptom  探针挂在 `ClipboardScrollView` 之外的对象上，打印出来一直是 undefined——**仪器本身错**
Change   把埋点方法补到 `ClipboardScrollView` 上
Evidence L?
Cost     这类"信号缺席先查仪器"的修正若被回滚，后续所有读数都是假的
Commit   63b06e3

### D-021 · 2026-09-29 · guard · v9
Symptom  `Gtk` / `Gdk` 导入未钉版本，解析到哪个版本取决于环境
Change   钉 `?version=4.0`
Evidence L?
Cost     钉版本让 GNOME 大版本变化在加载期就炸，而不是静默走错分支
Commit   142db30

### D-022 · 2026-09-29 · guard · v9
Symptom  `link.js` 的 Soup 导入未钉版本
Change   钉 `?version=3.0`
Evidence L?
Cost     同 D-021
Commit   4ad12b7

### D-023 · 2026-09-30 · fix · v9
Symptom  关闭动画被打断时漏掉 `popModal`，`modalCount` 永久残留，之后模态计数不可信
Change   打断路径也执行 popModal
Evidence L?
Cost     残留是单调的，一次泄漏 lasting 整个会话；L2 未验证
Commit   973c840

### D-024 · 2026-09-30 · perf · v9
Symptom  每个条目各建一份子 GSettings；style/layout 被无谓重建
Change   共享子 GSettings，跳过无谓的 style 与 layout 重建
Evidence L?
Cost     共享后一个写入会影响全体，改设置传播路径时要重看这条
Commit   2eec348

### D-025 · 2026-10-01 · perf · v9
Symptom  搜索过滤状态挂在 `actor.visible` 上，actor 一旦回收过滤就失真
Change   过滤状态下沉到 entry 层（**无用户可见行为变化**，是为窗口化铺路的重构）
Evidence L?
Cost     无行为变化 ⇒ 没有测试会替它把关，改动要靠读代码确认状态真源
Commit   ea06594

### D-026 · 2026-10-01 · perf · v9
Symptom  滚动容器以 actor 列表为真源，条目数直接决定常驻对象数
Change   真源改为 entry 列表，actor 降级为可回收缓存（无用户可见行为变化）
Evidence L?
Cost     与 D-025、D-027 是同一组结构改动，单独回滚其中一笔会留下不一致的真源
Commit   6e6f8ab

### D-027 · 2026-10-01 · perf · v9
Symptom  列表一次性为全部条目建 actor，常驻集随历史长度线性增长
Change   只给视口附近的条目建 actor，常驻集降到个位数
Evidence L?
Cost     窗口化的可见范围是本仓的核心规模决策之一，改范围要重新量
Commit   39c5ea8

### D-028 · 2026-10-01 · fix · v9
Symptom  `FileItem` / `LinkItem` 在 `await` 之后不检查取消，续体写到已销毁的 actor
Change   续体前检查取消状态
Evidence L?
Cost     与 D-007 同一类竞态；GJS 里对已 dispose 对象的访问是运行时错误，不是静默无效
Commit   0c277c3

### D-029 · 2026-10-01 · guard · v9
Symptom  `openProbeSummary` 只报时间，不报数据规模，读数无法解释自己
Change   同时报告 entry 总量
Evidence L?
Cost     只增输出，不改行为
Commit   a7372a4

### D-030 · 2026-10-10 · fix · v9
Symptom  落盘权限继承会话 umask：app-data 目录 0775、`clipboard.db` 与 `-wal` 0644、`images/*.png` 0664。剪贴板历史是原文存储的，唯一的遮挡是 `~/.local/share` 自己是 0700 —— 而 `database-location` 这个键恰好允许把目录搬到没有那层保护的地方
Change   每个写盘点加 `FileCreateFlags.PRIVATE` 并在写完补一次 `GLib.chmod`（`REPLACE_DESTINATION` 会重建 inode 把模式打回 umask，`PRIVATE` 只在新建时生效），`enable()` 开头 `makeStoredPrivate()` 纠正已在盘上的残留（含 `backup/`）
Evidence L1 `test/headless/probes/08-permissions.js`（enable 前亲手造残留再断言，不是观察）新代码 21/21；`git archive HEAD` 的副本 3/21；把 `NOFOLLOW_SYMLINKS` 弱化成 `NONE` 的副本 20/21（穿符号链接改了树外文件）
Cost     设权限在本机只有 `GLib.chmod` 一条路（`unix::set-perms` 被本地后端拒绝，`gi://GioUnix` 不内省 chmod/mkdir，原因写在 `constants.js`）。换平台或换 API 时要重新确认这条路还在
Commit   a93473c

### D-031 · 2026-10-10 · fix · v9
Symptom  `localeContains` 的记忆表是模块级 `const`，内层 key 是**整条未截断的剪贴板正文**；ESModule 在 shell 生命周期内不重载，于是已经删掉、已经裁剪的条目正文一直被留住
Change   改由 `SearchEntry` 实例持有 `_matchCache`，`SearchQuery` 从构造参数拿到它（第 8 个参数，`withChange()` 负责传递）
Evidence L1 `probes/09-cache-residue` 新代码 6/6（`entryTextsRetainedAtDisable=248`），HEAD 副本 1/6 且报错点名 "a module-level table is back"。RSS 只报数（257→254）：GJS 没有确定回收点，"没降"不等于"漏了"
Cost     缓存随实例生死 ⇒ 重建 `SearchEntry` 会丢热缓存；把表搬回模块级不会有任何测试变红，但会重新留住用户数据
Commit   1070951

### D-032 · 2026-10-10 · chore · v9
Symptom  `SearchEntry.addItem` 与 `ClipBoardEntryTracker.addItem` 撞名，读代码时反复跳错地方
Change   改名 `addFilterRow`（它加的是过滤行）。原先靠一张名字表 grep 找这类撞名，那条检查本身是永久误报，已由 `probes/07-wiring` 取代
Evidence L0 静态：改名无行为变化，`npm test` 113/113 只证明没弄坏别的
Cost     两个方向都不欠东西；`probes/07-wiring` 才是这类撞名的检测者，它从源码推导调用对并解析到活对象，自带投毒自测
Commit   1070951

### D-033 · 2026-10-10 · fix · v9
Symptom  `open()` 在 show 之前把 `_updateCursor` 设成 false，唯一把它设回 true 的地方是 `close()`；抢模态被拒这条分支里 `opened` 从未为真，`close()` 直接早退 ⇒ `show-at-pointer` 在整个会话里都是坏的。同一分支原先用 `logger.error`，渲染成 shell CRITICAL —— 那正是 `docs/maintenance/reading-the-log.md` 里回归闸门数的那一行
Change   该分支补回 `_updateCursor = true`，日志降级为 `warn`（别的客户端持有 SYSTEM_MODAL 是可恢复状况），并去掉重复的 `[Copyous]` 前缀（logger 已经加过一次，旧日志实测双份）
Evidence L1 `probes/11-grab-failure` 新代码 11/11（含"被拒后还能正常再开一次"与 modal 栈归零），HEAD 副本 10/11 且那次运行日志多出 1 条 CRITICAL
Cost     可恢复状况一律 `logger.warn`；写回 `error` 会把一次合法事件变成修不掉的假警报
Commit   85f29fe

### D-034 · 2026-10-10 · fix · v9
Symptom  图片通知预览把存下来的内容做 `body.substring('file://'.length)`，而存的是 `Gio.File.get_uri()` 的结果（`clipboard.js:411`），也就是 percent-encoded 文本 —— 于是尾巴被当作路径交给 GdkPixbuf，只有完全不含转义的路径能用。同文件里正确的形状本来就在旁边：`tryDecodeUri(...).substring('file://'.length)`（第 65、247 行）
Change   改 `Gio.File.new_for_uri(body)`，与 `clipboard.js:190` 同一形状
Evidence L1 `probes/10-notification-loopgap` 的 `escapedImagePathStillDecodes`：在隔离 app-data 里写一张 `probe 10 escaped.png`，把它的 `get_uri()`（含 `%20`）喂给 `notification()`，断言通知到达且正文是 `N×N px`；同探针另有 `bodyReportsPixelSize` / `previewIsAnImage` / `textBranchStillWorks`。本轮 419 项三臂全绿。诚实标注：**这条腿本轮没见过红** —— 按"先补覆盖再修"的顺序它是在修复之前写的，但本轮想复现投毒（在 /tmp 副本里把 `notifications.js` 退回 68b0e1e^）被权限层拦下，所以"见过红"只有前一轮的记录为凭
Cost     通知里的图片从此按 URI 语义处理，不许再退回字符串切片
Commit   68b0e1e

### D-035 · 2026-10-10 · perf · v9
Symptom  同一张图付两次全解码：`Pixbuf.get_file_info()` 与 `new_from_file_at_scale()` 各自打开并 inflate 整个 PNG，都在剪贴板 `owner-changed` 处理器里同步跑。两张真实截图（1728×1056 / 2419×1478）实测 18–78ms 加 17–57ms，一次图片复制让合成器停 ~86–130ms
Change   新增 `preview()`：一趟全解码，同时得出原始尺寸与缩放后的预览
Evidence L1 `probes/10-notification-loopgap` 实测 86ms 主循环空档；本轮三臂 36 会话 419 项复跑
Cost     仍然是同步的，这是有意的：分块喂 `PixbufLoader` 每 64KB 只花 0.5–0.9ms 但 `close()` 里 62ms（gdk-pixbuf 的 PNG 路径在数据末尾才 inflate），`new_from_stream_at_scale_async` 同样阻塞 32–50ms。低于单次解码的代价只剩"去掉预览"或"子进程解码"，记在 `docs/maintenance/open-items.md`
Commit   68b0e1e

### D-036 · 2026-10-10 · fix · v9
Symptom  `loadConfig()` 把 `JSON.parse` 的结果原样返回，而所有消费方紧接着做 `config.actions.map(...)`：一份**能解析但没有 `actions`** 的文件（手写、半截保存、或别的版本留下的）会让条目菜单、动作快捷键和整个 Actions 页同时失效，症状只有 2 条 `Unhandled promise rejection` —— 既不是 CRITICAL 也不是 JS ERROR，回归闸门完全看不见它。旧代码在抛异常之前已经 `_menuActions.forEach(a => a.destroy())`，于是留下一批已销毁但仍被引用的菜单项
Change   加载边界校验 `Array.isArray(parsed.actions)`，不成立回退 `defaultConfig` 并 `logger.warn`
Evidence L1 `probes/12-actions-config`（哨兵四条腿）新代码 8/8，去掉校验的副本 6/8（`after {} = not-an-array:undefined`）
Cost     "能解析不等于有效"从此是本仓对所有用户可编辑落盘文件的规则，不只是这一个文件。这条缺陷是我自己的探针造成的：2026-10-09 18:02 探针 08 的 `{}` 穿过一个软链落进真实 `~/.config`，条目菜单空了 1.5 小时
Commit   967595f

### D-037 · 2026-10-10 · fix · v9
Symptom  `disable-gda-warning` 只挡住第一条失败分支（`gi://Gda` 加载不了）；第二条 `GdaDatabase.init()` 抛异常那条无条件弹，于是用户按过 Disable Warning 之后照样被弹 —— 一个看起来无效的开关。第二条的 `logger.error` 还把 catch 到的异常丢掉，日志里只剩一句 "Failed to load Gda"
Change   两条读同一个键、给同一个按钮；第二条补上异常对象
Evidence L0b 文案侧 `test/prefs/run.sh` 5/5（`lib/preferences/dependencies/dependenciesSettings.js`）；L1 `probes/03` enable 全链路绿。**shell 侧行为要注销登录才生效**，本条只有代码读证
Cost     live 配置 `database-backend='sqlite'` 而 `initSqlite()` 走的正是 `gi://Gda` —— 这条分支不是边角路径，别当次要代码改
Commit   359774a

### D-038 · 2026-10-10 · fix · v9
Symptom  `contentInfo.js` 静态 `import Gst from 'gi://Gst'`。静态 import 一个可选 typelib 的失败形式不是"这个功能没有"，而是"扩展根本不加载"：gjs 在**模块解析期**就抛，文件里第一条语句都不执行（`gjs -m` 现场验过 —— import 后面那行 log 从未打印；同一命名空间用 `await import()` 则可以 catch）
Change   改在 `tryCreateMediaFileInfo()` 内 `await import('gi://Gst')`，缺席就 `logger.warn` 并省略媒体时长，与 `entryTracker.js` 的 Gda 同一个形状；Gst 在位时行为不变
Evidence guard L0 `test/shell-internals.test.js` 投毒用的是 `git archive HEAD` 的原代码：`FAIL: gi://Gst is imported statically in lib/ui/components/contentInfo.js but the shell's own install set does not guarantee it`，exit 2。**媒体时长分支本身没有任何探针覆盖**（fixture 里没有一行真能解出时长的音视频），已写进用户注销后的冒烟清单
Cost     Gst 不在担保集合内，而集合是 `gresource list + extract libshell-18.so` 推出来的 37 个命名空间，不是我觉得哪些算常见；抓到这个原形的是担保集合那条规则，"被动态 import 过就不许再静态 import"那条抓不到（当年 Gst 只有静态、从没动态过），所以两条都必须留在 CI 里
Commit   6ba6ade

### D-039 · 2026-10-10 · fix · v9
Symptom  三个键在 UI 里根本没有控件，其中 `disable-hljs-dialog` 原先唯一的写路径是那个询问框的 Cancel —— 按一次就永远不再问，而设置窗没有任何地方能改回来。恢复默认一侧：34 个调用点覆盖 43 个键
Change   补控件、补 `makeResettable` 入口，到 79 个控件 / 79 个有恢复入口
Evidence L0 `node scripts/settings-coverage.mjs` `RESULT: PASS`（82 键 / 8 条 schema 路径）；L0b `test/prefs/run.sh` 5/5
Cost     `paste-on-copy` 是唯一没有行的键，**不是缺陷**：`migrateSettings()` 把它折进 `swap-copy-shortcut` 并 reset。值绑在子页（`Adw.NavigationPage`，没有 `add_suffix`）上的那些键，按钮必须挂在**打开该子页的那一行**上；挂到页面本身会让整棵设置窗建不起来
Commit   978f0f8

### D-040 · 2026-10-10 · fix · v9
Symptom  设置窗第一次被仪器遍历就红：6 个分组无标题、24/83 行无副标题、28/38 个纯图标按钮无 tooltip、Theme 页两行同名同副标题；`edit-undo-symbolic` 一个图标两种语义
Change   逐条补齐：Shortcuts 3 个分组与 Actions 2 个分组补标题（Popup Menu 改名 Filter Menu，因为那一页管的确实是筛选菜单）、24 行逐条写副标题（先读 `searchEntry.js` / `clipboardDialog.js` / `contentInfo.js` 的真实行为再落字，不凭记忆）、view-more / dialog-warning / 语言过滤按钮补 tooltip、Theme 第二行改叫 Base Color Scheme（它选的其实是自定义色回退到哪套内置色）、Database 行那个不重置任何东西的按钮改成文字按钮
Evidence L0b `test/prefs/run.sh` 5/5（142 行 / 23 组 / 74 个图标按钮）
Cost     副标题是"这一项改什么"的唯一主人 —— README 键表故意不写这句话。删文案等于删文档，不是删装饰
Commit   978f0f8

### D-041 · 2026-10-10 · guard · v9
Symptom  `lib/preferences/**` 跑在独立 gjs 进程里，是 shell 侧唯一不需要注销就能验证的面，但没有任何检查会因为它红
Change   `test/prefs/run.sh` 在 Xvfb 下注册 shell 自己的 `org.gnome.Shell.Extensions` gresource、用 `GSETTINGS_BACKEND=memory` 建出真的 `Adw.PreferencesWindow`，遍历整棵树断言四条文案不变量（分组有标题、会改值的行有副标题、纯图标按钮有 tooltip、同一列表不许两行同名同副标题），末尾报 `(user data untouched)`
Evidence 本轮实跑 5/5 绿；第一次跑就红出 6/24/28 条缺陷，随后由 D-040 修
Cost     三个坑写在脚本头部：`GI_TYPELIB_PATH` 必须在第一个 `gi://` 之前含 `/usr/lib/gnome-shell/girepository-1.0`；`Adw.Row` 不在 typelib 里（公开基类叫 `Adw.PreferencesRow`）；`Gio.Application` 没有 `exit(code)`，不加 `hold()/release()` + `System.exit` 的话中途抛错的脚本仍然 exit 0 —— 所以"没打印 `# N/M checks passed`"判 NOT VERIFIED 而不是通过
Commit   5c2b286

### D-042 · 2026-10-10 · guard · v9
Symptom  headless 只有五只探针，三类失效都没有闸门：插桩本身读不到真值（探针 12 的第一版在删掉守卫的代码上报 7/7 绿）、disposed 警告（CRITICAL 闸门数不到它，实测差 12 vs 1）、探针写穿用户配置；而 `run.sh all` 每臂结果同名互相覆盖，只剩最后一臂在盘上 —— 这个套件存在的理由就是臂间对比
Change   新增 07-wiring / 08-permissions / 09-cache-residue / 10-notification-loopgap / 11-grab-failure / 12-actions-config（共 12 只 × 3 配置 = 36 会话）；产物按 config 命名前缀；disposed 报两个量（总数 / 可归因于本扩展的数，后者 >0 即 FAIL）；跑前跑后哈希 `~/.config/copyous@local`，不同就整轮判 `USER DATA TOUCHED`；`up.sh` 也重定向 `XDG_CACHE_HOME` 与 `XDG_CONFIG_HOME`，并在建完软链农场之后**断言**这两个根不是软链，是就拒绝启动。`make-fixture.js` 补一张真图（原先 7 张全是 74 字节色块）
Evidence 本轮 `run.sh all` 36 会话 419 项（live 151 / unwindowed 117 / horizontal 151）；归因规则在 12 条真实 foreign + 1 条本仓栈帧的构造日志上验过（输出 `14 2`）
Cost     `~/.local/share` 故意不哈希：真实会话在那里写历史，永远会不同，比大小会把测试写成罪犯。这道道防线不是假设出来的，见 D-036 的 Cost
Commit   d7b4f47

### D-043 · 2026-10-10 · guard · v9
Symptom  空闲 CPU 没法归因 —— 整壳 CPU% 里我们的份额看不出来，真实会话空转在几十个百分点，没有一丁点是本扩展的
Change   `test/headless/idle-cost.sh` 对同一个进程做差分：采 `/proc/<pid>/stat` 的 `utime+stime+cutime+cstime`（`CLK_TCK=100`，1 tick = 10 ms），并且**每个测量窗口前面配一个同长度的丢弃窗口**，否则 bare-shell 读数被延迟启动工作抬高、delta 算成负的
Evidence 本轮两次实跑：有偏的一版报 `-0.090 / -0.210 / -0.220`（仪器在说"扩展省了 CPU"），修好的一版 `+0.020 / -0.010`、均值 0.005，判据行 `NOT MEASURABLE`
Cost     这只脚本是搭在上一笔提交里的 —— `git add test/headless` 把它扫进了 `d7b4f47`，那笔的提交信息没有描述它。单独拆出来要重写历史，本仓禁止，所以把事实记在这里。读数分辨率 10 ms，低于它的一切"空闲差异"都不许当门用
Commit   d7b4f47

### D-044 · 2026-10-10 · guard · v9
Symptom  `makeResettable(row, settings, 'typoed-key')` 原样返回那一行：没有按钮、没有报错、没有运行时症状 —— 一个没有回头路的设置看起来完全健康
Change   `scripts/settings-coverage.mjs` 做 schema ↔ prefs 逐键静态对账，四种红法：控件没有恢复入口、prefs 用了 schema 没声明的键、有 reset 却找不到控件、`bind` 把键名写成变量（那种形状审计看不见，所以直接拒而不是跳过）
Evidence L0 `npm test` 113/113 含 `test/settings-coverage.test.js`；直接跑是 `RESULT: PASS`。四种红法逐条投毒过
Cost     有一条判据**故意降级**："reset 按钮挂错行"会产 12 条假警报，因为复合行本来就能一行管多键（position 管 6 个放置键、playSound 管 sound+volume、排除项行管整个子页），原因写在注释里免得下一个人加回来。自检：解析出的键数必须等于 `<key` 出现次数，不等 exit 2 —— 这是修完"漏了 `flags=`"那个真 bug 之后加的，当时它把真实存在的 `file-preview-types` 报成幽灵键
Commit   9b996dd

### D-045 · 2026-10-10 · guard · v9
Symptom  shell 侧对私有 API 与可选 typelib 的依赖原先靠人记住，而依赖清单一旦手抄就开始漂；D-038 是"记住"失败的实际代价
Change   `scripts/shell-internals.mjs` 从代码推导清单（本机 52 个 shell 侧文件 / 17 个私有模块 / 46 个私有符号 / 29 个文件带私有依赖，现场推导不许手抄），三条规则：静态 import 的命名空间必须在担保集合内、被 `await import()` 过的命名空间不许再被静态 import、清单与已安装 libshell 对撞漂移
Evidence L0 `node scripts/shell-internals.mjs` `RESULT: PASS`；`test/shell-internals.test.js` 在 `npm test` 里
Cost     担保集合由 `gresource list + extract libshell-18.so` 推出（37 个命名空间），不是我觉得哪些算常见。没有 libshell 的机器（CI）打印 `INERT`，测试断言的就是那个词 —— 不许把沉默当通过
Commit   9b996dd

### D-046 · 2026-10-10 · guard · v9
Symptom  README 的逐键表是手抄的，键名、默认值、范围三处各说各话时没有任何检查会发现
Change   `scripts/settings-reference.mjs` 由 schema 渲染 82 键的表（键名 / 类型 / 默认值 / 范围或选项，按 8 条 schema 路径分组），写进两份 README 的 `settings-reference` 标记之间；`--check` 比对现渲染与文件内容
Evidence L0 `node scripts/settings-reference.mjs --check` → `RESULT: PASS (82 keys, 8 schema paths)`；`test/settings-reference.test.js` 断言每份表的行数等于脚本报出的键数、且两份同尺寸
Cost     表里**故意不写每项做什么**：那句话的主人是设置窗每行的副标题（见 D-040）。覆盖率数字也从 `settings-coverage.mjs` 的输出读，不手打
Commit   9b996dd

### D-047 · 2026-10-10 · guard · v9
Symptom  `INVARIANTS.md` 这类"必须 stay wrong"的清单天生会被粘进 CHANGELOG 的句子撑成第二份副本，而维护手册拆成 `docs/maintenance/` 之后还有两种新的静默失效：没人链接的 topic 页面（等于不存在，于是同一个事实在别处被写第二遍），以及按章节号的引用（编号是老单文件的属性，现在指向虚无）
Change   `scripts/check-log.mjs --invariants` 现场打印所有 `kind:fix` 条目（id · 日期 · Commit · Symptom），零条即失败 —— 空白的不变量清单比没有更糟，因为它看起来是通过的；`test/repo.test.js` 加三条守卫：INVARIANTS 两份不含 CHANGELOG 的逐字行且必须点名上面那条命令、每个 topic 文件被 MAINTENANCE.md 链到、除 `docs/reports/` 之外任何 `.md/.js/.mjs/.sh` 不含章节号
Evidence L0 投毒：往 `INVARIANTS.md` 追加一行 CHANGELOG 的 `Symptom` 原文 → `not ok 1`，报错点名那一行；恢复后 5/5 绿。章节号那条第一次跑就抓到了我自己新写的页面
Cost     禁用的字符用 `String.fromCharCode` 构造，不写死 —— 守卫把禁的东西写进自己源码里就会踩自己。`docs/reports/` 的豁免也反向验过：在日期报告里加一个编号必须仍然绿
Commit   aeb5f2f

### D-048 · 2026-10-10 · guard · v9
Symptom  `shell-internals.mjs` 打印的 `statically imported namespaces` 把 prefs 进程的文件算进同一个集合，于是这一行里出现 `Gtk` 与 `Gdk` —— 而 `docs/maintenance/compatibility-matrix.md` 写的负事实是"shell 进程里没有 `gi://Gtk` / `gi://Gdk`"，仪器与文档当面互相矛盾。更要紧的是规则 2 抓不到 shell 侧的 Gtk：担保集合为了让 prefs 用 Adw/Gtk 把这两个名字收了进去，那条规则对它们**是瞎的**
Change   按安装集分开：打印成 `statically imported (shell-side)` 与 `statically imported (prefs process)`，`--json` 里 `staticallyImported` 改 shell 侧口径、新增 `staticallyImportedByPrefsOnly`；`test/shell-internals.test.js` 补一条分进程断言（shell 侧不许有 Gtk/Gdk，且 prefs-only 集合必须正好是 `Adw, Gdk, Gtk`）
Evidence L0 投毒：往 `lib/` 放一个 `import Gtk from 'gi://Gtk?version=4.0'` 的文件 → `not ok 3 - no Gtk or Gdk on the shell side, and the prefs-only set is named`；删掉后 114/114 绿、`RESULT: PASS`
Cost     顺带定下一条从没写下来的事实：`Adw` 也只属于 prefs 进程，shell 侧现场是 Clutter, Cogl, GLib, GObject, GdkPixbuf, Gio, Graphene, Meta, Pango, Shell, Soup, St（12 个）。prefs-only 集合一旦变化，说明两个进程的分界挪了，那条断言会先红
Commit   9a70edd

### D-049 · 2026-10-10 · fix · v9
Symptom  `logger.error` 渲染成 shell CRITICAL，而 CRITICAL 是回归闸门数的那一行 —— 于是**可恢复的环境状况**会把这台机器的健康闸门永久染红。这个规矩先前只在 `open()` 抢模态一处落过地（D-033），整类没扫过：Gda typelib 缺席、媒体时长探测失败、文件信息与文件预览建不出来、图片通知解码两处、链接元数据与缩略图两处、stylesheet 载入失败、`makeStoredPrivate()` 丢一次 chmod（那处注释本来写着 "never fatal"，代码却用 error）
Change   整类扫描（`rg 'logger\.error' extension.js lib`，去掉 prefs）后 **9 处降为 `logger.warn`**；留下的 error 只满足一条标准：**用户的库或数据真的受损**（修剪失败、条目类型认不出、建条目抛异常、Gda/JSON 后端起不来、删图与写库失败）
Evidence L1 改动后重跑 headless 臂；本轮真实会话读数（0 CRITICAL / 0 rejection / 0 disposed）是**上一批代码**的，这一批要注销才生效。扫描自身的一次翻车被 L1 当场抓住：`rg '\berror\('` 看不见 `.catch(error)`，删掉那行绑定后 enable() 报 `ReferenceError: error is not defined`，而 L0 看不见（`extension.js` 在 Node 里加载不了）
Cost     降级是把一类信号从 CRITICAL 移到 warning：**判据必须同时数 warn 家族**，否则真坏了反而看不见 —— 媒体时长那条就是靠 D-052 的探针补住的，不是靠日志级别
Commit   0a0368f

### D-050 · 2026-10-10 · fix · v9
Symptom  两处把用户内容写进 journal：`clipboardDialog.js` 的 `Unknown item type` 打印**整个 entry 对象**（剪贴板正文逐字进 `/var/log/journal`）；`actionMenu.js` 打印**动作的 stderr**，而动作的 stdin 就是条目正文，那条命令的输出可以原样带回密码本。本仓的历史本来就是明文存储，journal 不是私有存储
Change   两处都改成只留**类型与 id**（动作留 id），不再带内容
Evidence L0 代码读证；`grep` 复查这两行已无 `entry` / `stderr`。无仪器覆盖"日志里没有正文"这件事 —— 它需要一条新的判据，已记在 open-items
Cost     排查动作失败时不再能直接看到 stderr，要看动作 id 再去复现；这是有意的取舍
Commit   0a0368f

### D-051 · 2026-10-10 · guard · v9
Symptom  `run.sh` 的日志闸门数三种形态（`CRITICAL|JS ERROR`、`Unhandled promise rejection`、`has been already disposed`），**看不见 GLib 自己写的 C 侧失败**：那种行的消息体里没有 "CRITICAL"，级别与域名在 journald 的结构字段里（`PRIORITY=4`、`GLIB_DOMAIN=GLib-GObject`）。现场：这台机器跨 boot 有 **27 条** `g_object_unref: assertion 'G_IS_OBJECT (object)' failed`，每道闸门一直报 0；把模式放宽后跨 boot 命中从 19 涨到 **1720**（最大一族是 `clutter_text_{set_text,get_text,get_editable}: CLUTTER_IS_TEXT (self)` 各 190）
Change   新增第四段计数：`assertion .* failed|g_return_[A-Za-z_]+_fail|GLib-[A-Za-z]+-CRITICAL`，三档归因与 disposed 同构（总数 / 6 行内出现本仓栈帧或 `Gjs_common_gjs_` / 无法归因），**只有中间那档判红** —— C 侧断言不带 JS 栈，全算成自己的就天天假红
Evidence L0 合成日志验归因：纯外来 → `1 0`、紧跟本仓栈帧 → `1 1`、混合 → `2 1`；本轮 39 会话里总数 0（本仓确实没产生）。归因结论也落档：这批**不是本仓的**，两条独立证据是 `\.unref\(|g_object_unref` 在本仓 shell 侧命中 0（GJS 对 null 调 unref 抛 TypeError，打不出 GLib 断言），以及 disposed 附近栈帧分组为 shell ui 1664 / Vitals 1590 / notification-grouper 159 / caffeine 105 / blur-my-shell 8 / macos-dock 1 / **copyous 0**
Cost     两个查询坑一起记进 `docs/maintenance/reading-the-log.md`：大小写（消息体是小写 `assertion`，`grep 'Assertion'` 数到 0）、以及 `grep -c` 计数为 0 时自己 exit 1 会断掉 `&&` 链 —— 别把"链断了"读成"这条查过了"
Commit   03a74a0

### D-052 · 2026-10-10 · guard · v9
Symptom  `gi://Gst` 只服务 `tryCreateMediaFileInfo()` 的媒体时长，而那条分支**没有任何仪器覆盖**：fixture 的 255 行里没有一行真的音视频（真实库里也是 0 行），所以 D-038 的证据只有"扩展还能加载"，时长出没出、出得对不对，谁都没看过
Change   `make-fixture.js` 写一个 8kHz/16bit 单声道、时长 3 秒的真 WAV，**文件名带空格**（存进去就是 percent-encoded URI，与从文件管理器复制一致）；新增 `probes/13-media-duration`：期望时长**从该文件自己的 RIFF 头推导**（`dataSize / (rate * blockAlign)`，不抄代码里的常量），按类型过滤成 5 条 File 行让窗口化把它送进视口，再断言渲染出的时长标签；含一条**负腿**——非音频的 File 行不许长出时长控件
Evidence L1 `live 13` **10/10**；牙验过：期望故意 +1 秒 → **FAIL 9/10** 并打印真实标签 `["48","48","KB","KB","3s","3s"]`，之后按字节还原（`diff` 0 行）。写的时候踩了两处 GJS API 手误，都记在探针注释里：`GBytes.get_data()` 返回字节数组本身而不是 `[bytes, size]` 元组；St 的类名要 `get_style_class_name()`，没有 `get_style_classes()`
Cost     仍然覆盖不到的是**缺席分支**（没装 `gir1.2-gstreamer-1.0` 的机器）：本机 typelib 在位，造不出来，那条只有 `test/shell-internals.test.js` 的担保集合判据 + `gjs -m` 的机制验证据
Commit   03a74a0

### D-053 · 2026-10-10 · guard · v9
Symptom  39 会话全跑里 horizontal 臂 `06-ux-hidden` 超时之后，同一轮剩下 7 个探针全报 `shell never answered Eval` —— 而那 7 条**不是产品**。超时的壳（pid 215842）还活着：主线程 `state=S`、`wchan=futex_do_wait`、6 秒内 `utime+stime` 一字不动（所以不是在死循环），它攥着 mutter 的 wayland 锁，后面每个会话开局就打 `WL: unable to lock lockfile … maybe another compositor is running` + `libmutter-ERROR: Failed to create_socket`。`down.sh` 只发 SIGTERM，而阻塞在 C 调用里的进程根本跑不到信号处理器；它虽然为此 exit 1 并打 WARN，`run.sh` 又用 `>/dev/null 2>&1` 把这句吞了 —— 一次超时被放大成八个故障，且日志上看不出彼此有关
Change   `down.sh`：TERM 后复查，仍有存活就 `escalating to SIGKILL` 再复查一次；删 bus socket 挪到复查之后（先删会把那个壳自己的 socket 一起删掉，反而查不到它）。`run.sh`：接住 `down.sh` 的输出与状态码，升级这件事只留一行 note，**拆除失败就 `break 2` 停止整轮**，因为继续跑只会量产与产品无关的红
Evidence L0 正反对照各一次（`trap '' TERM` 的假壳，argv 带 harness 名）：`git show HEAD:test/headless/down.sh` → `WARN: 1 harness process(es) survived SIGTERM` + exit 1 + 进程照旧活着；改后 → `escalating to SIGKILL` + `harness down: no … processes left` + exit 0。改完第一次真跑就撞上同一条路径（horizontal/06 再次 450s 超时），日志里 `note: WARN … escalating to SIGKILL` 之后紧跟 `harness down`，那一轮其余会话不再被牵连。两个脚本 `sh -n` 通过
Cost     停整轮的代价是一次重跑（20–35 分钟）。06 为什么超时仍未定论（媒体路径已用标记探针排除，见 `docs/maintenance/open-items.md`），本条只保证它不再传染别人
Commit   43b14bc

### D-054 · 2026-10-10 · guard · v9
Symptom  `run.sh` 用 `ls probes/ | grep "^<前缀>-"` 解析探针名。同一个前缀命中两个文件时 `$name` 变成**两行**，拼出来的 eval 路径不存在：会话照样起来、结果文件永远不出现、450 秒后报一条与产品毫无关系的 TIMEOUT。踩点是我自己 —— 同一时刻放了 `99-diag-06.js` 和 `99-diag-media.js` 两个诊断文件，那一轮量的就是这个拼错的路径，白等 450 秒
Change   名字解析完先数行数，`>1` 就打 `ambiguous probe prefix: 99 matches …` 并 FAIL。**位置在 `up.sh` 之前**，所以拒绝是便宜的：不起会话、不等超时
Evidence L0：临时再放一个 `99-diag-zz.js` → `run.sh live 99` 立刻 exit 1 并打印该行，`pgrep -cf` 数到的 harness 进程为 **0**（确实一个会话都没起）；删掉临时文件后 `probes/` 里以 `99` 开头的只剩 1 个。`sh -n` 通过。两个诊断文件用完即删，仓里不留 `99-*`
Cost     三行 shell。它挡住的是"用一整轮会话去量一个文件名"，没有别的副作用
Commit   1b6395a
