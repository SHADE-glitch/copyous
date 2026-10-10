# 我们对 Shell 内部实现的依赖

对 shell 私有一切的依赖都集中在这里：抄实现要用的 ABI 库、有意提交的 gresource 编译产物、以及**每一个用到了 shell 私有符号的地方**（哪个文件、什么符号、为什么绕不开、升级时的症状）。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 8 节里的第 2、4 条，逐字复制；
> 下面那张依赖清单是 2026-10-09 由 `scripts/shell-internals.mjs` 现场跑出来再补上判断列的。
> 这个文件是这些事实的唯一主人，别在别处复述一遍。

## 1. 两条硬事实

1. ABI 库名：GNOME 50 是 `libshell-18.so`（不是 `libgnome-shell.so`）。要抄 shell 内部实现时用
   `gresource extract /usr/lib/gnome-shell/libshell-18.so /org/gnome/shell/ui/<file>.js`。

2. `theme.gresource` 与 `resources.gresource` 是**编译产物且有意提交**（本仓库没有构建步骤），
   而**仓库里没有 CSS 源码**。任何视觉改动都等于引入构建链 —— 那是不允许的。
   能读不能改：`gresource list theme.gresource` → `gresource extract theme.gresource <path>`
   （子命令是 `extract`，没有 `show`）。

## 2. 依赖清单怎么再生

清单的**符号列不许手抄**：它是代码的属性，改一行代码就过期。重跑：

```sh
node scripts/shell-internals.mjs          # 打印下表的前三列 + 总数
```

脚本只做机械部分：从源码里抓 `resource:///org/gnome/shell/**` 的 import、抓这些模块导出的
符号在本仓的调用点、抓 `global.*` 与 `Meta.*` / `Shell.*`，然后按符号汇总"哪些文件在用"。
它还顺带守一条判据（第 3 节末尾），红就 exit 2。
**为什么绕不开 / 升级症状 / 现状** 三列是判断，不在脚本输出里，改代码的人手动补，
补的时候必须对照被引用方在 shell 源码里的真实定义 —— 凭记忆填这三列就是伪造。

脚本的粒度是 `模块.成员`（`Main.layoutManager` 算一行），下面的表比它更细，因为
`layoutManager` 的五个用法风险完全不同级 —— 这是判断列存在的意义，不是两张表。

## 3. 清单（本机 2026-10-09 实测）

规模（`node scripts/shell-internals.mjs` 的末尾四行原样）：**扫描 52 个 shell 侧文件**、
**17 个私有模块**（其中 14 个 `resource:///org/gnome/shell/**`，另 3 个是 `global`、`gi://Shell`、
`gi://Meta` —— 它们是 typelib，但 ABI 跟着 shell 大版本走）、**46 个私有符号**、
**29 个文件带私有依赖**。

其中三行不算"脆弱依赖"：`extensions/extension.js` 导出的 `Extension`、`_`、`ngettext` 是官方
文档给的写法（`_` 覆盖 16 个文件，`ngettext` 4 个），风险面和 `Main.layoutManager` 那种完全不
同级，列在这里只是为了让总数能对上。

| 符号 | 用在哪 | 为什么绕不开 | 升级时的症状 | 现状 |
| --- | --- | --- | --- | --- |
| `extensions/extension.js` → `Extension` | `extension.js` | 基类，没有它就不是一个扩展 | 只会在大版本改构造函数签名时断，且断得很响 | 已在本机 50.1 跑通 |
| `ui/main.js` → `Main.layoutManager.modalDialogGroup` | `lib/ui/clipboardDialog.js` | 扩展自建的整屏对话框必须挂进 shell 的合成层；公开替代（`ModalDialog`）会抢全局模态，我们不要它的模态 | 容器改名 ⇒ `add_child` of undefined ⇒ enable 当场抛，不会静默 | 已在本机 50.1 跑通 |
| `ui/main.js` → `Main.layoutManager.uiGroup` | `editDialog.js`、`clipboardItemMenu.js`、`searchEntry.js` | 同上：三类浮层的挂载点 | 同上 | 已在本机 50.1 跑通 |
| `ui/main.js` → `Main.layoutManager.dummyCursor` | `clipboardItemMenu.js` | `PopupMenu` 构造必须给一个 anchor actor，而条目菜单是跟着鼠标走的，没有真实 actor | `dummyCursor` 消失 ⇒ 菜单构造失败；条目菜单整块失效 | 已在本机 50.1 跑通 |
| `Main.layoutManager.setDummyCursorGeometry()` | `clipboardDialog.js` | 让跟随鼠标的浮层在指针被 `grab` 之后仍有位置可算 | 方法改名 ⇒ TypeError，打开对话框时炸 | 已在本机 50.1 跑通 |
| `Main.layoutManager.emit('system-modal-opened')` | `clipboardDialog.js` | 我们自己 `pushModal`，但 shell 的其它部分（面板、其它扩展）靠这个信号让路；不发就会和别的扩展抢键 | **最脆的一条**：信号名变了不会报错，只会静默失效 ⇒ 表现为"打开对话框后某些快捷键被面板吃掉" | 需人工确认（见第 5 条） |
| `Main.pushModal / popModal` | `clipboardDialog.js` | 键鼠独占的唯一入口 | 返回类型变了就是静默 bug：45→49 返回 `Grab` 对象、更早返回 seat 值。我们已按 `VERSION` 分流 | 已在本机 50.1 跑通 |
| `Main.inputMethod`（`connectObject`/`disconnectObject`、`cursor-location-changed`） | `clipboardDialog.js`、`lib/misc/keyboard.js` | 编辑框要跟着输入法的候选窗走，只有这个信号给出光标位置 | 信号改名 ⇒ 中文/日文输入时候选窗错位，无报错 | 已在本机 50.1 跑通 |
| `misc/ibusManager.js` → `getIBusManager()` | `clipboardDialog.js` | 同上，拿到 ibus 句柄才能读 surrounding text | 函数不存在 ⇒ enable 抛，响 | 已在本机 50.1 跑通 |
| `Main.wm.addKeybinding / removeKeybinding` | `lib/misc/shortcuts.js` | GNOME 的快捷键注册必须由 shell 的 WM 做，直接 grab 键在 Wayland 上不合法 | 签名变 ⇒ 快捷键静默不注册；enable 时 Main.wm 可能还没就绪，所以我们的 enable 体先让出一轮 idle | 已在本机 50.1 跑通 |
| `Main.panel` | `lib/ui/indicator.js` | 状态图标要加进面板 | `panel` 被重构（如快速设置化）⇒ 图标位置错乱或消失 | 已在本机 50.1 跑通 |
| `Main.messageTray` | `lib/misc/notifications.js` | 我们要一个**自定义 Source**（带按钮、可"关掉这类提示"），DBus 通知做不到 | Tray 重构 ⇒ 通知不出现或 Source 重复 | 已在本机 50.1 跑通 |
| `Main.getStyleVariant()` | `lib/misc/theme.js` | 决定用深色还是浅色样式表；`gtk-application-prefer-dark-theme` 不足以覆盖 accent/contrast 组合 | 返回形状变 ⇒ 主题选错，界面变样但不崩 | 已在本机 50.1 跑通 |
| `ui/popupMenu.js`（`PopupMenu`、`PopupMenuSection`、`PopupMenuManager`、`PopupBaseMenuItem`、`PopupMenuItem`、`PopupSeparatorMenuItem`、`PopupSubMenuMenuItem`、`PopupSwitchMenuItem`、`Ornament`） | 7 个文件 | 所有条目菜单、搜索下拉、标签菜单的控件本体 | 这一族最稳（第三方扩展几乎都用它），断则全树菜单当场抛 | 已在本机 50.1 跑通 |
| `ui/boxpointer.js` → `BoxPointer.PopupAnimation` | 4 个文件 | 浮层的展开动画枚举 | 枚举项改名 ⇒ 动画参数变 undefined，表现为浮层不淡入 | 已在本机 50.1 跑通 |
| `ui/modalDialog.js` → `ModalDialog` | 3 个文件 | 编辑/二维码/确认对话框的基类 | 同族 | 已在本机 50.1 跑通 |
| `ui/dialog.js` → `Dialog.MessageDialogContent` | 3 个文件 | 只要它的内容区，不要整窗 | 类改名 ⇒ 构造抛 | 已在本机 50.1 跑通 |
| `ui/layout.js` → `Layout.MonitorConstraint` | `clipboardDialog.js` | 让对话框跟随光标所在显示器 | 枚举改名 ⇒ 多屏时弹到错误屏幕 | 已在本机 50.1 跑通 |
| `ui/messageTray.js` → `Source`、`Notification` | `lib/misc/notifications.js` | 见上 | 构造函数签名变 ⇒ 通知路径抛 | 已在本机 50.1 跑通 |
| `ui/panelMenu.js` → `Button` | `lib/ui/indicator.js` | 面板图标基类 | 同族 | 已在本机 50.1 跑通 |
| `ui/checkBox.js` → `CheckBox` | `lib/ui/indicator.js` | 面板菜单里的勾选行；`Switch` 观感不对 | 类没了 ⇒ 面板菜单构造抛 | 已在本机 50.1 跑通 |
| `misc/animationUtils.js` → `wiggle()` | `lib/ui/indicator.js` | 快捷键冲突时的抖动反馈 | 函数改名 ⇒ 无反馈，静默 | 已在本机 50.1 跑通 |
| `misc/dateUtils.js` → `formatTimeSpan()` | `lib/ui/items/clipboardItemHeader.js` | 时间戳要跟着 locale 走，自己拼会写死格式 | 改名 ⇒ 条目头当场抛 | 已在本机 50.1 跑通 |
| `misc/config.js` → `PACKAGE_VERSION` | `lib/misc/compatibility.js` | 唯一的版本探测入口，下面第 4 条的分流全依赖它 | 字段名变 ⇒ enable 抛 | 已在本机 50.1 跑通 |
| `global.compositor`（`disable_unredirect`/`enable_unredirect`） | `clipboardDialog.js` | 不关掉 unredirect，打开对话框时首帧会拿到旧屏幕内容（实测表现为闪一下） | 方法改名 ⇒ TypeError；不成对调用 ⇒ 合成器性能永久劣化，**这条成对性由探针 02 看着** | 已在本机 50.1 跑通 |
| `global.focus_manager` | `clipboardDialog.js`、`clipboardScrollContainer.js`、`tagsItem.js` | Tab/方向键在窗口化列表里的移动只能走它的 `add_tabgroup`/`get_focus_child` | 语义变 ⇒ 焦点跑到屏幕外 | 已在本机 50.1 跑通 |
| `global.display` | `clipboardDialog.js`、`editDialog.js`、`lib/misc/clipboard.js` | 键码、显示器、 seat 相关都在这 | 同族 | 已在本机 50.1 跑通 |
| `global.stage` | `lib/misc/theme.js`、`notifications.js` | `St.ThemeContext.get_for_stage(global.stage)` 是取当前主题的唯一路 | 同族 | 已在本机 50.1 跑通 |
| `global.workspace_manager` | `clipboardDialog.js` | 对话框跟随当前工作区 | 40 时代改名过一次；再改就是抛 | 已在本机 50.1 跑通 |
| `global.get_pointer()` | `clipboardItem.js`、`clipboardDialog.js` | 点击位置决定菜单落点 | 同族 | 已在本机 50.1 跑通 |
| `Meta.later_add` | `clipboardDialog.js` | 等 shell 把这一帧真正合成完再计时/取尺寸，`idle` 做不到（会早于重绘） | `Meta.LaterType` 语义变 ⇒ 首帧数字失真，不影响功能 | 已在本机 50.1 跑通 |
| `Meta.SelectionSource`、`Meta.SelectionType` | `lib/misc/clipboard.js` | 主选中（primary selection）的读写在 Wayland 上必须带来源标记 | 枚举变 ⇒ 复制静默失败 | 已在本机 50.1 跑通 |
| `Meta.KeyBindingFlags`、`Meta.accelerator_name`、`Meta.Cursor` | `lib/misc/shortcuts.js`、`editDialog.js` | 快捷键注册与自定义光标 | 同族 | 已在本机 50.1 跑通 |
| `gi://Shell` → `Shell.ActionMode`（`SYSTEM_MODAL`、`ALL`） | `clipboardDialog.js`、`lib/misc/shortcuts.js` | 模态与快捷键的作用域 | 枚举变 ⇒ 模态行为整体错乱 | 已在本机 50.1 跑通 |
| `gi://Shell` → `Shell.GLSLEffect`（子类化 + `registerClass`） | `lib/ui/items/clipboardItem.js` | 条目内容区要"绕开"头部按钮挖一个洞，这需要自定义 shader。`Shell.GLSLEffect` 是 shell 里唯一暴露给扩展的 GLSL effect 基类，`get_uniform_location` / `set_uniform_float` / `vfunc_build_pipeline` / `vfunc_paint_target` 全来自它，配套的还有 `Graphene.Point3D` 和 `apply_relative_transform_to_point()` | **风险最高的一条视觉依赖**：基类改名或 uniform 传入方式变化 ⇒ 每个条目构造时当场抛；shader 编译失败 ⇒ 只有 cogl 一行 warning，动画静默消失（CSS 里没有任何东西引用这个 effect，所以坏了也不会留下样式痕迹） | 已在本机 50.1 跑通（三臂 headless 每次都建这些条目） |

## 4. 已经按版本分流的四处

这些是本仓**已经付过升级代价**的地方，也是上面 `Config.PACKAGE_VERSION` 存在的理由：

| 位置 | 条件 | 差别 |
| --- | --- | --- |
| `lib/ui/clipboardDialog.js:463` | `VERSION >= 50` | grab 失败判定：50 用 `grab.is_revoked()`，49 及以下用 `grab.get_seat_state() !== Clutter.GrabState.ALL` |
| `lib/ui/clipboardDialog.js:504` | `VERSION >= 49` | 打开动画：49 起改 `EASE_OUT_QUAD` + 0.96 缩放 |
| `lib/ui/clipboardDialog.js:571` | `VERSION >= 49` | 关闭动画：同上 |
| `lib/ui/indicator.js:127` | `VERSION < 50` 直接 return | 面板图标的右键手势菜单是 50 才有的 API |

## 5. 为什么没有"集中隔离"

AGENTS.md 要求"必须依赖 shell 私有 API 时集中隔离"。**现状没做到，而且不是本次改动造成的**：
这 32 个符号是上游 2.0.1 就分散在 9 个 UI/misc 文件里的既成事实，把它们抽进一个 `lib/shell/` 门面
属于"为你看不见的指标做重构"（没有疼痛证据），而且会把 `clipboardDialog.js` 里那些和动画、
时序耦合在一起的调用拆散到两个文件 —— 那更难读。

因此这里的替代措施是**清单本身**：升级时先跑 `node scripts/shell-internals.mjs`，拿新旧两版输出做
diff，符号消失（而不是改名）也能被发现；第 4 列写的是症状，用来决定读哪段日志。
**新增**私有依赖时仍然要求集中：放进 `lib/misc/compatibility.js` 或紧挨着它的兄弟模块，别新开一
个文件只为拿一个私有符号。

## 6. prefs 侧那条路径

`lib/preferences/**` 里 33 个文件都 import
`resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` 只为拿 `gettext as _`。
它是 GNOME 官方扩展文档里的写法（大写 `Shell`、`/Extensions/js/` 前缀，和 shell 侧小写
`resource:///org/gnome/shell/...` 是两套路径），所以算"被祝福的私有路径"，升级时的风险面
与上面 32 个符号完全不同级。它也不在 shell 进程里跑 —— 见 [verification.md](verification.md)
的 L0b：整个 `lib/preferences/**` 由 `test/prefs/run.sh` 在 Xvfb 下真建整棵树验证，不需要注销。
