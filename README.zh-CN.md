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
| 操作系统 | Ubuntu（已在 Ubuntu 26.04 验证）——其他发行版**未验证** |
| GNOME Shell | 48 – 50 |
| Libgda | Libgda 5.0 或 6.0，**需带 SQLite 支持** |
| GSound | 可选，用于提示音 |

```bash
# Ubuntu / Debian（已验证）
sudo apt install gir1.2-gda-5.0 gir1.2-gsound-1.0

# 本分支未测试，仅列出包名供参考：
# Fedora
sudo dnf install libgda libgda-sqlite gsound
# Arch Linux
sudo pacman -S libgda6 gsound
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

本节是**本地分歧清单**，用于将来与上游对比：记录改了什么、为什么、在哪个提交。
基线快照是 `335fff2`（上游 2.0.1 + 接手时已有的 fork 状态）。本地提交数**有意不写死**——
`git rev-list --count 335fff2..HEAD` 才是权威，硬编码的数字总会过时。

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

### 本地提交（按类别；括号内为提交）

**数据库 / 性能**

- Gda 5 语句自适应轮询（`a30ac0e`）：`GDA5_POLL_PLAN` = 2ms×25 → 10ms×25 → 100ms×7。Gda 5 无异步完成回调，固定 100ms 间隔会给每次查询强加 ≥100ms 下限（每次复制 4 条语句、启动 5 条）。
- SQLite 启用 WAL + `synchronous=NORMAL`（`16cbbd3`）：本机实测每次插入 ~1.9ms → ~0.09ms。`NORMAL` 仅与 WAL 同用才安全——断电可能丢最后几个事务但不损坏文件，对剪贴板历史可接受。
- 仅在确实有条目可淘汰时才裁剪历史（`6ba6862`）：原先每次插入都跑一次 `ORDER BY datetime` 扫描 + DELETE，而可裁剪数通常正好卡在上限，白跑。
- 减少启动期文件存在性扫描（`8e158b3`）；避免代码条目的重复自动识别（`51e65ba`，同一段代码被 `highlightAuto` 探测两次）；缓存动作正则、为对话框打开计时、修复公共目录遍历（`0c463b2`）。
- 记忆化 `localeContains`、collator 提升为模块级（`040dcb7`，每次按键都会对相同「文本 × 查询」组合重复做 ICU 比较）；搜索加 100ms debounce（`f0761fe`）。

**渲染规模 / 内存**

冻结的三个症状（开机后首开极慢、久置后重开卡 3–4 秒、开了立刻关再开卡几秒）根因不是某段慢代码，而是**常驻规模**：255 棵 item 树 ≈ 5669 个 actor + 255 个 `HoleEffect`（`Shell.GLSLEffect`），实测边际 **~241–243 KB/条**、固定 10.4MB、内容 30MB、暖身 11MB，合计 **~105MB 始终驻留**。本机 gnome-shell 有 **898MB 被换出**、全机 swap 用掉 8.4GB，于是"打开弹窗"变成一场 major fault 风暴——这也解释了"UI 不动但鼠标还能动"（光标走 KMS 硬件平面，不经过 shell）。

- 搜索过滤状态从 `actor.visible` 搬到 entry 层的 `_filterState`（`ea06594`）：`visible` 原先被 `search()` 和渲染两边共用，是窗口化的唯一硬阻塞。搬到 entry 层之后，一条记录可以在**根本没有 actor** 的情况下被过滤，增量搜索的 Same/LessStrict/MoreStrict 规则也还能读回上一轮的判定。实测等价：9180 次比对 0 处不一致。
- 滚动容器改为**以 entry 列表为真源、actor 降级为可回收缓存**（`6e6f8ab`）：`_entries`（有序）/ `_filtered`（子序列）/ `_items`（entry→actor）三者分离，创建与销毁收敛到 `_syncWindow()`，窗口范围由 `_materialized()` 单点给出。这一步**行为逐条不变**（窗口=全量），只是把"哪些 entry 该有 actor"挪到了一个可以收窄的地方。顺带修掉 4 处：`addEntry()` 丢了 `grab_key_focus`（复制新内容时选中高亮不再跟随）、内容改动致条目失配时焦点交接失效、`_layoutChildren()` 每次 add/keystroke 全量重挂子节点、`openProbeSummary()` 索引基准用错。
- **只给视口附近的条目建 actor**（`39c5ea8`）：`_materialized()` 在 item 尺寸沿滚动轴均匀时返回 `_filtered` 上「视口 ± 一屏」的一段，窗口外由头尾两个 spacer 顶住滚动范围。**门控条件是 `!(竖向 && dynamic-item-height)`** —— 高度随内容变化时 spacer 无法精确，所以动态高度 = 不窗口化。同机同数据的对照 A/B（唯一变量是 actor 数）：

  | | 窗口化 | 全量 |
  | --- | ---: | ---: |
  | 填充后常驻 actor | 3 | 255 |
  | 填充后 RSS | 247MB | 333MB |
  | 首开 `show` / TTI | 42.0 / 65.1 ms | 319.5 / 423.2 ms |
  | 第三次开 TTI | 11.9 ms | 172.4 ms |
  | 3 轮开关后 RSS | 256MB | 474MB |
  | 滚动一屏的中位耗时 | **18.2 ms** | 1.4 ms |

  代价如实写在这里：**滚动慢了 13×**，每跨一个窗口边界要销毁+重建约 2 个 item（~9ms/个）；一屏 overscan 以内的小滚动是零成本（未加力的 `_syncWindow()` 在 lo/hi 未变时立即返回）。RSS 是**高水位、不会回落**（glibc 不把释放的 GJS 内存还给 OS；走完整个列表后 398MB，回到顶部只降到 391MB），所以窗口化靠的是"正常使用时根本到不了那个水位"，不是靠回收。
- 共享子 GSettings、跳过 item 的无谓 `style` 与 layout 重建（`2eec348`）：六个 item 类各自 `settings.get_child('<type>-item')`（最多 255 个活 GSettings 对象）、`updateSize()` 无条件写 `this.style`（CSS 重解析 + 主题节点失效 × 每条目）。headless A/B n=1：`filled` 1474 → 1327ms；常驻增量 105.2 → 103.5MB（**1.7MB，与两次运行之间 2.6MB 的基线抖动同量级，视为未证实**）。不改变 actor 数与 GLSL effect 数，即不触及结构性成本。

**安全 / 正确性**

- **将所有 Gda 查询参数化**，移除字符串拼接 SQL，并在 21 个文件做一轮正确性/性能/清理（`5f1f63e`）：消除 SQL 注入面；同时修掉 `unescapeContent` 把 `\\` 折叠成 `\`、从而永久损坏含反斜杠条目的问题（改为参数绑定 + 一次性数据迁移）。`deleteOldest` 的字符串手术**有意跳过**（见下）。
- 恢复被模态抓取抢走的弹窗键盘焦点；修正 `focusChild` 拼写（`9e32688`）：`pushModal()`/`system-modal-opened` 会把 key focus 抢到外层 modal actor，导致全部键盘操作失效；`focus_child` 在 St 中不存在，原调用抛 TypeError 并中断其后的信号连接。
- 统一两个使用方的 `actions.json` 监视守卫（`610e242`，`shortcuts.js` 与 `actionMenu.js` 条件不一致）；`.mo` 文件重命名为 `copyous@local.mo` 以匹配 `gettext-domain`（`c9032cb`）。

**资源泄漏 / 生命周期**

- 释放每次启用/禁用都泄漏的资源（`7283fb8`，涉及 `sound.js`、`notifications.js`、`qrCodeDialog.js`、`codeLabel.js` 等 8 个文件）；丢弃在禁用之后才完成的异步初始化，引入 `_enableGeneration` 代数计数器（`ad5cb9f`）。
- 关闭动画被打断时漏掉 `popModal`，`Main.modalCount` 永久残留（`973c840`）：150ms 关闭动画期间再按一次快捷键，`open()` 的 ease 会**替换**掉那个 transition，而 Clutter 从不执行被替换 transition 的 `onComplete`（50.1 实测 `closeOnCompleteFired: false`）——于是 `Main.popModal()` 被跳过。`popModal()` 在 `modalCount > 0` 时**提前 return**，走不到 `layoutManager.modalEnded()`、`enable_unredirect()` 和 `actionMode` 复原，所以计数器会整会话地留在 ≥1；同一 actor 上二次 `pushModal` 还会撤销前一次 grab 却留下栈记录。修法是把关闭收尾抽成幂等的 `_finishClose()`，`onComplete` 与 `open()` 顶部（先 `remove_all_transitions()`）两处都调它；`close()` 也补上此前从未调用的 `cancelProgressiveReveal()`，否则一次快速关闭会留下最多 31 个 idle 分片与下一次打开抢 CPU。
- 修复条目移除时从不 `destroy()` 的泄漏；补齐整条 JS 销毁链与 `releaseModalState()`；`decodeURI` 改 `tryDecodeUri()`；`deleteOldest()` 串行化 + `busy_timeout=800`（`f0761fe`）：`clearItems()`/`removeItem()` 只 `remove_child` 从不 `destroy()`，每条目 11+ 个挂在进程级 `ext.settings` 上的处理器把整棵 widget 树钉住，journal 累计 130 次 GC 清扫期回调拦截。

**测试 / 工具 / 文档**

- `color.js` 四个缺陷 + 首个测试套件（44 断言，`4860c24`）：零 alpha 的 hex 被当不透明；`parseNamed` 用 `in` 命中原型链（`Color.parse('constructor')` 抛 TypeError，经 `clipboard.js:366` 会整条丢弃历史）；色相 `-360` 归一成 360 越界；灰阶 HWB 塌成近黑。
- `glob.js` 的 `[!...]`/`[...]` 类以字面 `]` 开头时误译 + 19 断言（`c51e620`）：产出的正则里 `[]` 是空类（永不匹配）、`[^]` 是任意字符，与 glob 语义完全相反。
- `settings.js`、`actor.js` 单测（合计 37 断言，`65a78b5` `0a1e342`）——五个可被 Node 加载的纯模块现已覆盖四个。
- 文档：新增 `AGENTS.md`（`17ca8a4`）；双语 README 补「测试」一节（`5b2636c`）与上游归属（`430e64b`）；徽章、真实 clone 地址、卸载章节、维护者署名（`a9f89f1`）；分歧清单持续更新（`954e22e` `c59a8a4`）；内置 GPL-3.0 LICENSE 全文（`68c89d1`）。
- 埋点：把渐进揭示总时长拆成 `work`/`gap`/`pseudo`/`setup` 四段互斥账（`7df1fee`）；`open(): show` 后加只读内容构成埋点 `openProbeSummary()`（`e9bc801`）；把埋点方法补到 `ClipboardScrollView` 上，探针此前只打印 `undefined`（`63b06e3`）。
- GI 兼容：`Gtk`/`Gdk` 导入钉 `?version=4.0`（`142db30`）；`link.js` 的 `Soup` 导入钉 `?version=3.0`（`4ad12b7`）。

### 已知但**有意未修**的分歧点

记录下来，避免将来重复评估：

- **`gda.js` 的 `deleteOldest()`**：用 `selectSql.replace('select1', ...)` 字符串改写、子查询执行两次（一次取 id、一次删除）。Gda 5 的 JS 绑定**不暴露** `add_subselect`，也无法在复合语句里用 `ORDER BY`，`5f1f63e` 已标注 "Skipped intentionally"。收益仅在 `history-time > 0` 且真触发裁剪时出现（行数 ≤500、毫秒级、低频），不值得踩 libgda 绑定行为细节。
- **`clipboard.js` 的 250ms 粘贴延迟**：在等关闭动画（`ANIMATION_TIME = 150`）+ `popModal` + 焦点回归目标窗口完成，否则合成按键会落在 shell 的模态抓取上；缩短它有把粘贴打到错误窗口的真实风险。
- **`contentInfo.js` 的 `Intl.Segmenter` 全文计数**：已有 `TEXT_COUNT_LIMIT = 10000` 上限；实测 107 条 2k 文本的 grapheme 计数共 18.8ms，不是瓶颈。
- **`highlightAuto` 的 2000 字符切片**：GJS 实测 26.19ms（29 语言子集）vs 29.05ms（全 36 语言），语言子集只省 10%，真正成本来自切片长度；降到 500 字符可到 6.66ms 但会降低语言探测准确率，属用功能换指标。
- **首开渐进揭示的几秒是环境量，不是 CPU 成本，别去"优化"它**：`_revealSlice` 已把总时长拆成 `work`/`gap`/`pseudo`/`setup` 四段互斥账。可复核的逐 boot 实测（242 条 / 31 片，ms）：`1811 = 86+1657+62+5`、`1986 = 76+1848+57+5`、`2490 = 54+2369+63+4`、`3279 = 92+3105+77+5`——**91–95% 是 gap**，即 `PRIORITY_DEFAULT_IDLE` 源在等主循环空出来（正是它该做的：把 CPU 让给输入与合成器），真实每条 CPU 仅 **0.22–0.38ms**。同一段揭示跨会话分别是 1811ms 与 3279ms（代码未变，差 81%），也证明它是环境量而非固定成本。因此不做"视口感知揭示"（最多省几十 ms 后台 CPU，却要同时改 `updateVisible()` 计数、首尾伪类、搜索过滤三条路径，改错会出现"滚下去是空白"）。**（`39c5ea8` 之后此条仅对未窗口化路径成立：**视口窗口化**已实现，窗口化下 `beginProgressiveReveal()` 直接 return，因为只剩 7–16 个 actor、没有全量绘制可分批；当年"滚下去是空白"的风险由头尾 spacer 的精确算式承担，实测竖向 `upper` 在 7 个滚动位置恒为 46398 = 255×170+254×12。）**
- **`idle after redraw` 首开那次被揭示的 gap 污染**：该探针跑在 `PRIORITY_LOW(300)`，`DEFAULT_IDLE(200)` 的揭示分片必然先排空，故首开这个数几乎等于 gap。验收应看 `TTI (main loop free)` 与**后续**打开的 `idle`，首开值只作参考，不要当回归判据。
- **`history-length` 只约束淘汰，不截断显示**：全仓库仅 `entryTracker.js` 两处用到它，都在裁剪路径上。对话框渲染库里**全部**行，稳态行数 = `history-length` + (pinned + tagged)，实测 `history-length 250` 配 7 pin + 2 tag 时 `filled 259 entries`。含义：**pin 越多渲染越多且无上限**——真要控制规模，该限的是 pin 数而不是 `history-length`。另：底部那几条 pinned/tagged 永不被替换，淘汰前沿是"最老的非 pinned 非 tagged"那条，位置在永生块**上方一格**，所以盯着列表最底部看不出历史在滚动，这是设计行为。
- **`open(): show` 暖开中位 300ms → 406ms 不是本仓库的回归，别再查一遍**：四条独立证据都指向会话级环境而非代码——① `f0761fe..HEAD` 只有 `color.js`/`glob.js`/`clipboardScrollContainer.js` 三个运行时文件变动，全不在 show 路径上（`color.js` 的改动只会更快）；② 同一段**未改动**的揭示循环里 `work`/条从 0.223ms 涨到 0.380ms，而纯 DB+JS 的 `filled` 稳定在 1563–1669ms，即"每单位 JS 变贵、启动不变"；③ 负载最低的 boot 给出最快的 205ms，负载最高的给出 406ms 中位与 895ms 峰值；④ 9-27 18:06 有一次 apt 升级（Chrome 153→154、Edge、VS Code、gnome-shell-ubuntu-extensions）。旧基线 183/209/319 记在 PID 3000/32015 上，而这两个 PID 在 journal 中零条日志、不可复核，故作废——真实移动是 +35%，不是翻倍。**（此条全部数字为 `39c5ea8` 窗口化之前所测：窗口化下填充只建 3 个 actor，headless 同数据 `filled` 从 ~1400ms 降到 ~100ms，真实会话的数待注销登录后复测，届时本条的 `filled` 引用值已过时。）**
- **`show` 不能当回归判据**：同一 boot 内散布 2.65×（337–895ms，n=6），首开与暖开的相对关系还会在 boot 间翻转。一次代码回归不可能同时让冷路径变快又让暖路径变慢。判回归请看 `TTI (main loop free)`，并接受"受控 A/B 需要注销登录"这个代价；`e9bc801` 的内容构成埋点就是为了下次开机能直接对上背景。
- **横向列表窗口化时 `upper` 短 15px/端，有意不修**：主题里 `.clipboard-item:first-child{margin-left:15px}` 与 `:last-child{margin-right:15px}` 只对**真正携带该伪类的那个 item** 生效，所以当列表首/尾落在窗口外时，extent 比全量少 15px（144588 vs 144603，0.01%）。竖向不受影响（`show-header=true` 把 `margin-top` 覆盖成 0，实测精确）。不修的原因：吸收它要么把主题常量硬编码进 JS，要么把伪类移到窗口边缘——后者会在 `show-header=false` 时给窗口首项加上 15px `margin-top`，变成一个随滚动往下爬的可见空隙。另：`theme.gresource` 是编译产物、**仓库里没有 CSS 源码**，所以"改 CSS"这条路等于引入构建步骤（本扩展无构建链，见前置依赖）。
- **窗口化下滚动变慢 ~13× 是这项改动的代价，不是回归，别回滚查它**：每跨一个窗口边界要销毁+重建约 2 个 item（实测中位 18.2ms/屏、最差 67.8ms，全量模式 1.4ms）。一屏 overscan 以内的小滚动仍是零成本。换来的是首开 TTI 423→65ms、3 轮开关后 RSS 474→256MB。要改只能上 actor 复用池，那是另一个量级的改动。
- **`dynamic-item-height` 就是窗口化的实际开关，且 "Compact" 预设会静默关掉它**：`profiles.js` 里 `CompactProfile` 把它设回 `true`（竖向 + 动态高度 = 不窗口化），`DefaultProfile` 是 `false`。所以点了 Compact 之后所有窗口化收益会无声消失——排查"怎么又卡了"先看这个 key。
- **`lib/misc/actor.js` 运行时已零引用但有意保留**：`6e6f8ab` 之后容器不再靠遍历子节点做导航，该模块在运行时无人 import，但 `test/actor.test.js` 仍在测它、`AGENTS.md` 仍把它列为四个可被 Node 加载的纯模块之一。删它要连带改测试与三处文档，属 churn；留着运行时零成本（ESM 只加载被 import 的模块）。
- **9-28 boot 独有的 `Can't update stage views actor … needs an allocation`**（10 行，只在那次 895ms 打开后 67ms 出现，其余 4 个 boot 全为 0）：含义是对话框子树尚未分配就被要求更新 stage view，那一帧不绘制、下一帧补。30 次打开只出现 1 次、无功能故障、本机无法复现 → **待确认**，不为此改代码。

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
