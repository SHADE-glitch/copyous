<p align="right"><a href="README.md">English</a> | <a href="README.zh-CN.md"><b>简体中文</b></a></p>

# Copyous —— 本地维护分支

一款面向 GNOME 的现代剪贴板管理器。

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Based on: Copyous](https://img.shields.io/badge/based%20on-Copyous-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/copyous)

## 项目说明

本仓库是 **boerdereinar** 的 [**Copyous**](https://github.com/boerdereinar/copyous) 的**个人维护分支**，冻结在上游 **2.0.1** 版本，以 `copyous@local` 为 UUID 在本地维护。

本项目**与上游作者无关**，也未获得其背书。本分支完整保留上游功能，重点提升**正确性、安全性、性能与资源管理**——尤其是将 SQLite 查询参数化、调优数据库、并消除启用/禁用时的资源泄漏。

> Copyous 本身是 [Pano](https://github.com/oae/gnome-shell-pano) 剪贴板管理器的完全重写。

## 功能特性

- **剪贴板历史**，支持文本、代码、图片、文件、链接、字符、颜色与二维码。
- **SQLite 后端**（通过 GNOME Data Access / Libgda 5 或 6），另可选 JSON 与内存后端。
- 全历史**搜索**，支持**置顶**、**九种彩色标签**与**隐身（incognito）模式**。
- **可自定义动作**（`actions.json`）——执行命令、打开颜色、生成二维码。
- **复制即粘贴（paste-on-copy）**、主选择区同步、按应用（WM class）排除。
- 基于 GResource 的**主题**、可选的 **highlight.js** 语法高亮、**GSound** 提示音。
- **D-Bus 接口**（`org.gnome.Shell.Extensions.Copyous`），可显示、隐藏、切换与清空历史。
- **82 个 GSettings 键**与 **8 种语言翻译**（de、fr、it、pl、pt_BR、ru、tr、zh_CN）。

## 前置依赖

| 依赖 | 说明 |
|---|---|
| GNOME Shell | 48 – 50 |
| Libgda | Libgda 5.0 或 6.0，**需带 SQLite 支持** |
| GSound | 可选，用于提示音 |

```bash
# Fedora
sudo dnf install libgda libgda-sqlite gsound
# Arch Linux
sudo pacman -S libgda6 gsound
# Ubuntu / Debian
sudo apt install gir1.2-gda-5.0 gir1.2-gsound-1.0
# openSUSE
sudo zypper install libgda-6_0-sqlite typelib-1_0-Gda-6_0 typelib-1_0-GSound-1_0
```

## 安装

```bash
git clone https://github.com/SHADE-glitch/copyous.git ~/.local/share/gnome-shell/extensions/copyous@local
gnome-extensions enable copyous@local
```

在 Wayland 下需注销后重新登录，GNOME Shell 才会加载扩展。

### 卸载

```bash
gnome-extensions disable copyous@local
rm -rf ~/.local/share/gnome-shell/extensions/copyous@local
```

## 使用

按 `Super` `Shift` `V` 打开剪贴板对话框，也可点击面板指示器。

| 操作 | 快捷键 |
|---|---|
| 打开剪贴板对话框 | `Super` `Shift` `V` |
| 切换隐身模式 | `Super` `Shift` `Ctrl` `V` |
| 复制条目 | `Enter` / `Space` |
| 执行默认动作 | `Ctrl` `Enter` / `Space` |
| 置顶条目 | `Ctrl` `S` |
| 删除条目 | `Delete`（按住 `Shift` 强制删除） |
| 跳转到条目 | `Ctrl` `0` … `9` |
| 切换置顶搜索 | `Alt` |
| 切换条目类型 | `Ctrl` `Tab` / `Shift` `Ctrl` `Tab` |

## 偏好设置

打开 **GNOME 设置 → 扩展 → Copyous → 设置**，可配置数据库后端与位置、外观与主题、指示器与对话框行为、提示音、快捷键、标签与动作。

## 测试

四个模块不含 GNOME/GI 导入，因此可用纯 Node 运行 —— 无需 `gjs`、无依赖、无构建步骤：

```
npm test
```

- `lib/common/color.js` → `test/color.test.js`（各空间钳位、色相归一、parse 优先级、可逆转换）
- `lib/common/glob.js` → `test/glob.test.js`（锚定、区分 `/` 的通配符、globstar、字符类、花括号展开、元字符转义）
- `lib/common/settings.js` → `test/settings.test.js`（绑定生命周期，以及 `paste-on-copy` 迁移）
- `lib/misc/actor.js` → `test/actor.test.js`（仅可见项的遍历及其边界）

`lib/common/color.js` 依赖 GNOME Shell 注入的全局 `Math.clamp`，因此 color 测试会先装上那一行定义再构造 `Color`。`lib/` 里的其余模块都导入 `gi://`，只能在实机验证。

## 相对上游的改动（2.0.1）

本节是**本地分歧清单**，用于将来与上游对比：逐条记录改了什么、为什么、在哪个提交。
基线快照是 `335fff2`（上游 2.0.1 + 接手时已有的 fork 状态），其上有 16 个本地提交。

> 提示：本仓库**没有**设置上游 remote，`origin` 指向分支自己的仓库。
> 若要与上游对比，请单独 `git remote add upstream https://github.com/boerdereinar/copyous.git`
> 后 `git fetch upstream`，再用 `git diff upstream/main...HEAD` 查看分歧面。

### 基线快照 `335fff2` 已包含的 fork 改动

接手时树里就不是干净的上游导出，以下差异在基线内、无独立提交：

| 改动 | 为什么 |
| --- | --- |
| `uuid` 改为 `copyous@local` | 与上游版本并存安装，避免冲突 |
| keybinding 注册加固：整个 `enable()` 主体推迟到低优先级 idle | GDM 自动登录 / 挂起恢复时 `Main.wm.addKeybinding` 尚未就绪 |
| `clipboardDialog.warmup()` + 渐进揭示（progressive reveal） | 登录后首次打开弹窗时，冷缓存下的 `show()` 曾阻塞主循环达 11 秒 |
| `ClipboardEntryTracker` 的历史裁剪与未来时间戳钳制 | 时钟漂移 / 时区错误会让条目排到列表顶部 |

运行时资产（`theme.gresource`、`resources.gresource`）是**有意提交**的：本扩展没有构建步骤，直接从该目录运行，删掉会让全新检出无法工作。

### 本地提交（按时间正序）

| 提交 | 类别 | 改了什么 | 为什么 |
| --- | --- | --- | --- |
| `a30ac0e` | perf(db) | Gda 5 语句自适应轮询（`GDA5_POLL_PLAN`：2ms×25 → 10ms×25 → 100ms×7） | Gda 5 无异步完成回调；固定 100ms 间隔给每次查询强加了 ≥100ms 下限（每次复制 4 条语句、启动 5 条） |
| `c9032cb` | fix(i18n) | `.mo` 文件重命名为 `copyous@local.mo` | 文件名必须匹配 `metadata.json` 的 `gettext-domain`，否则翻译不生效 |
| `6ba6862` | perf(db) | 仅在确实有条目可淘汰时才裁剪历史 | 原先每次插入都跑裁剪（一次 `ORDER BY datetime` 扫描 + 一次 DELETE），而可裁剪数通常正好卡在上限，白跑 |
| `16cbbd3` | perf(db) | SQLite 后端启用 WAL + `synchronous=NORMAL` | 本机实测：默认 delete+FULL 下每次插入 ~1.9ms，wal+NORMAL 下 ~0.09ms。`NORMAL` 仅与 WAL 同时使用才安全——断电可能丢最后几个事务，但不会损坏文件，对剪贴板历史可接受 |
| `610e242` | fix | 统一两个使用方的 `actions.json` 监视守卫 | 守卫条件在 `shortcuts.js` 与 `actionMenu.js` 之间不一致 |
| `040dcb7` | perf(search) | 记忆化 `localeContains`，collator 提升为模块级 | 每次按键都会对相同的「文本 × 查询」组合重复做 ICU 比较 |
| `7283fb8` | fix | 释放每次启用/禁用都泄漏的资源 | 涉及 `sound.js`、`notifications.js`、`qrCodeDialog.js`、`codeLabel.js` 等 8 个文件 |
| `ad5cb9f` | fix | 丢弃在禁用之后才完成的异步初始化 | 引入 `_enableGeneration` 代数计数器，异步续体在 `await` 之后比对代数 |
| `8e158b3` | perf | 减少启动期的文件存在性扫描 | `constants.js`、`icons.js`、`extension.js` 启动路径上的重复 `query_exists` |
| `51e65ba` | perf | 避免代码条目的重复自动识别 | 同一段代码被 `highlightAuto` 探测两次 |
| `0c463b2` | perf | 缓存动作正则；为对话框打开计时；修复公共目录遍历 | `Color.parse` 等路径每次调用都重新编译正则 |
| `5f1f63e` | fix | **将所有 Gda 查询参数化**（移除字符串拼接 SQL），并在 21 个文件做一轮正确性/性能/清理 | 消除 SQL 注入面；同时修掉 `unescapeContent` 把 `\\` 折叠成 `\` 从而永久损坏含反斜杠条目的问题（改为参数绑定 + 一次性数据迁移）。**有意跳过** `deleteOldest` 的字符串手术（见下） |
| `9e32688` | fix | 恢复被模态抓取抢走的弹窗键盘焦点；修正 `focusChild` 拼写 | `pushModal()`/`system-modal-opened` 会把 key focus 抢到外层 modal actor，导致全部键盘操作失效；另 `focus_child` 在 St 中不存在，原调用抛 TypeError 并中断其后的信号连接 |
| `430e64b` | docs | 新增双语 README（EN + zh-CN），标注上游归属 | — |
| `68c89d1` | chore | 内置 GPL-3.0 LICENSE 全文 | 履行许可证义务 |
| `a9f89f1` | docs | 仓库徽章、真实 clone 地址、卸载章节、维护者署名 | — |
| `f0761fe` | fix | 修复条目移除时从不 `destroy()` 的泄漏；补齐整条 JS 销毁链与 `releaseModalState()`；`decodeURI` 改 `tryDecodeUri()`；`deleteOldest()` 串行化 + `busy_timeout=800`；搜索加 100ms debounce；填充期 `warmup()`；打开链路加 TTI 埋点 | 详见该提交正文。核心是 `clearItems()`/`removeItem()` 只 `remove_child` 从不 `destroy()`，每条目 11+ 个挂在进程级 `ext.settings` 上的处理器把整棵 widget 树钉住，journal 累计 130 次 GC 清扫期回调拦截 |
| `7df1fee` | chore(timing) | 把渐进揭示的总时长拆成 `work`/`gap`/`pseudo`/`setup` 四段互斥账 | 单看总时长无法区分"8 条 show 花了 157ms"和"idle 源等了 157ms"，只有前者值得优化 |
| `4860c24` | fix | `color.js` 四个缺陷 + 首个测试套件（44 断言） | 零 alpha 的 hex 被当不透明；`parseNamed` 用 `in` 命中原型链（`Color.parse('constructor')` 抛 TypeError，经 `clipboard.js:366` 会整条丢弃历史）；色相 `-360` 归一成 360 越界；灰阶 HWB 塌成近黑 |
| `c51e620` | fix | `glob.js` 的 `[!...]`/`[...]` 类以字面 `]` 开头时误译 + 19 断言 | 产出的正则里 `[]` 是空类（永不匹配）、`[^]` 是任意字符，与 glob 语义完全相反 |
| `65a78b5` `0a1e342` | test | `settings.js`、`actor.js` 单测（合计 37 断言） | 五个可被 Node 加载的纯模块现已覆盖四个 |
| `17ca8a4` `5b2636c` | docs | 新增 `AGENTS.md`；双语 README 补「测试」一节 | — |
| `e9bc801` | chore(timing) | `open(): show` 后增加只读内容构成埋点 `openProbeSummary()` | `show` 是 paint-bound，不记录屏幕上是什么就无法归因 |

### 已知但**有意未修**的分歧点

记录下来，避免将来重复评估：

- **`gda.js` 的 `deleteOldest()`**：用 `selectSql.replace('select1', ...)` 做字符串改写，且子查询执行两次（一次取 id、一次删除）。原因是 Gda 5 的 JS 绑定**不暴露** `add_subselect`，也无法在复合语句里用 `ORDER BY`。`5f1f63e` 明确标注 "Skipped intentionally"。任何改写都踩在 libgda 绑定行为细节上，而收益仅在 `history-time > 0` 且真的触发裁剪时出现（行数 ≤500，毫秒级、频次低）。
- **`clipboard.js` 的 250ms 粘贴延迟**：它在等关闭动画（`ANIMATION_TIME = 150`）+ `popModal` + 焦点回归目标窗口完成，否则合成的按键会落在 shell 的模态抓取上。缩短它有把粘贴打到错误窗口的真实风险。
- **`contentInfo.js` 的 `Intl.Segmenter` 全文计数**：已有 `TEXT_COUNT_LIMIT = 10000` 上限；实测 107 条 2k 文本的 grapheme 计数总共只要 18.8ms，不是瓶颈。
- **`highlightAuto` 的 2000 字符切片**：GJS 实测 26.19ms（29 语言子集）vs 29.05ms（全 36 语言）——语言子集只省 10%，真正的成本来自切片长度。降到 500 字符可省到 6.66ms，但会降低语言探测准确率，属于用功能换指标。
- **首开渐进揭示的 4.8–6.6 秒不是 CPU 成本，别去"优化"它**：`_revealSlice` 已把总时长拆成 `work`/`gap`/`pseudo`/`setup` 四段互斥账。真实会话实测 `244 items in 31 slices, 6567ms = work 201 + gap 6275 + pseudo 86 + setup 5`——**95.5% 是 gap**，即 `PRIORITY_DEFAULT_IDLE` 源在等主循环空出来（这正是它该有的行为：把 CPU 让给输入与合成器）。真实每条 CPU 只有 **0.82ms**。因此"视口感知揭示"（只 map 折叠线内条目）最多省约 180ms 后台 CPU、摊在 6.5 秒内用户无感，却要同时改 `updateVisible()` 计数、首尾伪类、搜索过滤三条路径，改错会出现"滚下去是空白"。同一段揭示在不同会话分别是 4853ms 与 6567ms（代码未变，差 35%），也证明它是环境量而非固定成本。
- **`idle after redraw` 在首开那次被揭示的 gap 污染**：该探针跑在 `PRIORITY_LOW(300)`，所有 `DEFAULT_IDLE(200)` 的揭示分片必然先排空，于是首开的这个数几乎等于 gap。验收应看 `TTI (main loop free)` 与**后续**打开的 `idle`；首开那个值只作参考，不要拿它当回归判据。
- **`history-length` 只约束淘汰，不截断显示**：全仓库仅 `entryTracker.js` 的两处用到它，都在裁剪路径上。所以对话框渲染的是库里**全部**行，稳态行数 = `history-length` + (pinned + tagged)。实测 `history-length 250` 配 7 pin + 2 tag 时 `filled 259 entries`。含义：**pin 越多渲染越多且无上限**——真要控制规模，该限的是 pin 数而不是 `history-length`。另：底部那几条 pinned/tagged 永远不会被替换，淘汰前沿是"最老的非 pinned 非 tagged"那条，位置在永生块**上方一格**，所以盯着列表最底部看不出历史在滚动，这是设计行为。
- **`open(): show` 从 9-25 暖开中位 300ms 涨到 9-28 的 406ms 不是本仓库的回归，别再查一遍**：四条独立证据都指向会话级环境而非代码——① `f0761fe..HEAD` 只有 `color.js`/`glob.js`/`clipboardScrollContainer.js` 三个运行时文件变动，全部不在 show 路径上（`color.js` 的改动只会更快：`toLocaleLowerCase`→`toLowerCase`、`in`→`hasOwn`、去掉三目）；② 同一段**未改动**的揭示循环里 `work`/条 从 0.223ms 涨到 0.380ms，而纯 DB+JS 的 `filled` 稳定在 1563–1669ms，即"每单位 JS 变贵、启动不变"；③ 负载最低的 boot（零浏览器窗口）给出最快的 205ms，负载最高的（103 次窗口活动/4.3h）给出 406ms 中位与 895ms 峰值；④ 9-27 18:06 有一次 apt 升级（Chrome 153→154、Edge、VS Code、chatgpt、gnome-shell-ubuntu-extensions）。**此前记录的基线 183/209/319 作废**：它记为 PID 3000/32015，而这两个 PID 在 journal 中零条日志，不可复核——真实移动是 +35%，不是翻倍。
- **`show` 不能当回归判据**：同一 boot 内散布 2.65×（337–895ms）、n=6，且首开与暖开的相对关系会在 boot 间翻转（9-25 首开 847 是暖开的 2.8 倍，9-28 首开 369 ≈ 暖开中位）。一次代码回归不可能同时让冷路径变快又让暖路径变慢。要判回归请看 `TTI (main loop free)`，并接受"受控 A/B 需要注销登录"这个代价。`e9bc801` 的内容构成埋点就是为了下次开机能直接对上背景。
- **9-28 boot 独有的 `Can't update stage views actor … needs an allocation`（10 行，只在那次 895ms 打开后 67ms 出现，其余 4 个 boot 全为 0）**：含义是对话框子树尚未分配就被要求更新 stage view，那一帧不绘制、下一帧补。30 次打开只出现 1 次、无功能故障、本机无法复现 → **待确认**，不为此改代码。

## 参与贡献

欢迎提交 Issue 与 Pull Request。请保持改动范围聚焦，并针对上述 GNOME Shell 版本进行测试。

## 致谢与来源说明

本扩展是 **boerdereinar** 的 **Copyous** 的**维护分支**。原始设计与功能均出自其手。

- **上游：** [boerdereinar/copyous](https://github.com/boerdereinar/copyous) —— 许可证 **GPL-3.0-or-later**
- **上游作者：** boerdereinar
- **分支基线：** 上游 **2.0.1**（提交 `335fff2`）
- **第三方：** [qrcodegen.js](https://github.com/nayuki/QR-Code-generator)，作者 Project Nayuki —— **MIT**
- **借鉴来源：** 剪贴板与键盘处理模式改编自 [Tudmotu/gnome-shell-extension-clipboard-indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator)（GPL）；颜色名数据源自 [colorjs/color-name](https://github.com/colorjs/color-name)。
- **上游脉络：** Copyous 是 [Pano](https://github.com/oae/gnome-shell-pano) 的完全重写。

## 许可证

本项目采用 **GNU 通用公共许可证 v3.0 或更高版本** —— 见 [LICENSE](LICENSE)。

作为 Copyous 的衍生作品，本分支继续沿用 GPL-3.0-or-later，并保留上游版权声明。

© boerdereinar 及贡献者；分支修改 © SHADE-glitch。
