# CHANGELOG — copyous@local

Personal maintenance fork of [Copyous](https://github.com/boerdereinar/copyous) upstream 2.0.1,
imported frozen at `335fff2`. This file records only deviations I introduced after that import.

Coverage: 335fff2..HEAD
Check with `npm run check:log`. Entries are `D-###`, monotonic, never reused.
An entry states what was true **as of its commit**, not current state: old entries are not
re-verified, and aggregate counts live in the checker's output, never in this file.

> **How these were written.** `Symptom` / `Change` are compressed from the commit subject plus the
> state of the touched file at HEAD; the diffs were not re-read one by one. Treat an entry as an
> index into its commit. `Evidence` names a test only where that suite was re-run in the session
> that wrote the entry; everything else is `L?` on purpose.

`kind` here uses five values: `fix` / `perf` / `taste` / `guard` / `revert`. `perf` is separated
from `fix` because most of this fork's work is resource and throughput work — dropping it
re-introduces measurable degradation but not a correctness bug, and an upgrade needs to know which
is which.

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
