# 平台需求与升级检查单

这个扩展需要什么、哪些组合真在本机验证过、GNOME 大版本升级时按什么顺序检查。

> **来历**：正文前三条是从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）第 8 节的第 1、3、5 条逐字搬来的；
> 下面两张表是 2026-10-09 在本机现场查出来的，每个数都能用它那一行的命令重取。
> 这个文件是这些事实的唯一主人，别在别处复述一遍。

## 1. 三条不会变的规矩

上游冻结在 2.0.1，所以每一次 GNOME 大版本升级都是这里的事：

1. `metadata.json` 的 `shell-version` 目前是 `["48","49","50"]`。**不改它，扩展在新 shell 上直接不加载。**
   这是有意的安全闸（宁可不加载也不要半死不活地跑），但升级时必须主动加进去。

2. 升级后第一件事是 `./test/headless/run.sh all`，因为 `--headless` / `--unsafe-mode` /
   `--virtual-monitor` 这三个 flag 的行为一变，整套验证就静默失效。`up.sh` 会打印它们。

3. `Math.clamp` 不是 JS 内置，由 shell 注入。`lib/common/color.js` 依赖它，所以
   `test/color.test.js` 里装了 shim；新增能跑在 Node 下的测试时要同一个 shim。

## 2. 本机实测到的组合（2026-10-09）

**只有这一列是真跑过的**。声明支持 ≠ 验证过；这张表的价值就在最后那一列。

| 层 | 本机实测值 | 重取命令 | 验证到什么程度 |
| --- | --- | --- | --- |
| 发行版 | Ubuntu 26.04.1 LTS | `grep PRETTY_NAME /etc/os-release` | 唯一被测发行版；别的发行版**未验证**（`libgda` 的 soname 在 Debian/Arch 上不同） |
| 会话类型 | Wayland | `echo $XDG_SESSION_TYPE` | 真实会话与 headless 都是 Wayland；**X11 从未加载过这个扩展** |
| GNOME Shell | 50.1 | `gnome-shell --version` | 已运行验证：真实会话 + 36 个 headless 会话 |
| shell 内部 ABI | `libshell-18.so`、`Meta-18.typelib`、`Clutter-18.typelib` | `ls /usr/lib/gnome-shell/ /usr/lib/x86_64-linux-gnu/mutter-18/` | 已运行验证 —— [shell-internals.md](shell-internals.md) 那 46 个符号全建立在这个 18 上 |
| gjs | 1.88.0 | `gjs --version` | 间接验证（每一行 JS 都在它上面跑，包括 `test/prefs/` 那个独立进程） |
| GLib / GIO | 2.88.0 | `dpkg-query -W -f='${Version}\n' libglib2.0-0t64` | 已运行验证（`GLib.chmod`、`GdkPixbuf`、`Gio.Settings` 全在这条上） |
| GTK / libadwaita | `Gtk-4.0.typelib`、`Adw-1.typelib` | `ls /usr/lib/x86_64-linux-gnu/girepository-1.0/` | **仅 prefs 进程**：`test/prefs/run.sh` 在 Xvfb 下真建 86 行、74 个图标按钮，5/5 绿。shell 进程里没有 Gtk/Gdk（合规，见第 4 节） |
| libgda | 5.2.10，`Gda-5.0.typelib` | `dpkg -S /usr/lib/x86_64-linux-gnu/girepository-1.0/Gda-5.0.typelib` | **live 后端实际用的就是它**：`database-backend='sqlite'` ⇒ `initSqlite()` ⇒ `await import('gi://Gda')`。Gda 6 未验证；`DEBUG_COPYOUS_GDA_VERSION` 这个环境变量就是为版本错配留的手动旋钮 |
| SQLite | 3.46.1 | `dpkg-query -W -f='${Version}\n' libsqlite3-0` | `sqlite3` CLI 只被用来**读**（一律 `file:…?mode=ro`）；写路径完全在 libgda 里面 |
| JSON 后端 | 代码存在，本机未启用 | `gsettings get … database-backend` | **未验证** —— live 是 `sqlite`，`json` 分支只有 `lib/database/json.js` 自己的读码证据 |
| highlight.js | v11.11.1，127k，装在 `~/.local/share/copyous@local/highlight.min.js` | `head -2 ~/.local/share/copyous@local/highlight.min.js` | 已运行验证（Code 条目高亮走它）。`languages/` 目录里只有 **1** 个语言包（dockerfile），其它语言按 `getHljsPath()` 回落到主包 |
| GStreamer | 1.28.2 + `Gir1.2-gstreamer-1.0` | `ls /usr/lib/x86_64-linux-gnu/girepository-1.0/Gst-1.0.typelib` | 成功分支**已运行验证**（2026-10-10 起）：`make-fixture.js` 现在写一个时长已知的真 WAV（名字带空格，所以存的是 percent-encoded URI），探针 13 从文件自己的 RIFF 头推出期望再看条目上渲染出的时长徽标，`live 13` = 10/10。**缺席分支仍然无法在本机制造**（typelib 装着），那条只有 `test/shell-internals.test.js` 的担保集合判据与 `gjs -m` 的机制验证据 |
| GSound | `GSound-1.0.typelib` | 同上目录 | 未验证 —— 动态加载，headless 没有声音设备，复制音效分支从未跑过 |
| libsoup | 3.0 | 同上目录 | 未验证 —— 只给链接卡片抓标题；headless 故意不联网（fixture 预置了 `metadata.title`），所以这条网络路径一次都没跑过 |
| Node | 本机 22.22.1，CI 20 | `node --version` | 有意分工：五个纯模块的单测 + 四个仓库守卫在 Node 上跑（CI 用 20 足够）；`test/headless/make-fixture.js` 用 `node:sqlite`，**需要 ≥22.5**，而 CI 从不跑它。CI 绿 ≠ 造数据脚本能在 CI 的 Node 上跑，别把这两件事混为一谈 |

## 3. 依赖分三级，搞错级别会做出错误的"兼容"

| 级别 | 成员 | 缺了会怎样 |
| --- | --- | --- |
| **硬（shell 自带）** | `gi://Shell`、`St`、`Clutter`、`Meta`、`Gtk`、`Adw`、`Pango`、`Graphene`、`Cogl` | 这些由 shell 进程注入，装了就一定在；缺了意味着根本不在 GNOME 上跑 |
| **可选，且代码知道** | `gi://GSound`（音效）、`gi://Gda`（除 JSON/Memory 外的持久化）、`highlight.min.js`（代码高亮） | 动态加载 + 明确回落：Gda 缺 ⇒ 历史退回 memory 或 json 并弹一次通知（`disable-gda-warning` 管这个通知），GSound 缺 ⇒ 静音，hljs 缺 ⇒ 纯文本代码 + 一次可关的安装询问 |
| **可选，但代码曾经不知道** | `gi://Gst`（媒体时长） | **F19，2026-10-09 改掉**：原先是文件顶层 `import Gst from 'gi://Gst'`，而所有消费方在模块解析期就依赖它 ⇒ 没装 `gir1.2-gstreamer-1.0` 的机器上**整个扩展加载失败**，只为了少显示一个时长。现在改成 `tryCreateMediaFileInfo()` 内部 `await import()` + `logger.warn` 回落。守卫 = `test/shell-internals.test.js`（判据是"任何被 `await import()` 过的命名空间都不许再被静态 import"，集合从代码里推导，不是写死的清单）；时长本身自 2026-10-10 起由**探针 13** 守（fixture 里那个真 WAV 的时长从 RIFF 头推导，不看代码里的常量） |

**这条判据值得单独记住**：一个 typelib 是不是可选，不看文档，看**代码里有没有人动态加载过它**。
加载过就说明作者认定它会缺失并处理了缺失；此时任何一处静态 import 都是自相矛盾，而且失败的
形式是"整个扩展不加载"，不是"这个功能没有"。

## 4. 两条负事实（同样是兼容信息）

- **shell 进程里没有 `gi://Gtk` / `gi://Gdk`**。核对命令（注意那个 `\b`，`gi://GdkPixbuf` 会伪装成 `gi://Gdk`）：

  ```sh
  grep -rlE "gi://(Gtk|Gdk)\?" lib/ extension.js thirdparty/ | grep -v '^lib/preferences/'
  ```

  空输出才对。历史上我因为漏了这个边界，把 `GdkPixbuf` 误报成"Gtk 泄漏进 shell"，那次是**假**的。
  这条现在不必再靠人跑 grep：`node scripts/shell-internals.mjs` 把两个安装集分开打印
  （`statically imported (shell-side)` 与 `statically imported (prefs process)`，后者现场是
  `Adw, Gdk, Gtk`），`test/shell-internals.test.js` 断言 shell 侧那两个名字不出现、且 prefs-only
  集合正好是这三个 —— 集合变了就说明两个进程的分界挪了。
  （在此之前仪器的打印行没分进程，把 prefs 侧的 Gtk/Gdk 算进"静态导入集合"，看起来正好在否定
  本条事实；这条负事实当时不可查。）
- **没有构建步骤**。`gschemas.compiled` 与两个 `.gresource` 是提交进仓库的产物，所以
  本机不需要 glib-compile-schemas / glib-compile-resources。装了也不该跑 —— 跑出来的产物
  和提交的不一致时，改的是源码还是产物要先分清楚，那是另一个坑。

## 5. 升级检查单（按顺序，别跳）

1. `gnome-shell --version` 记下新值；`ls /usr/lib/gnome-shell/` 看 ABI 号（`libshell-NN.so`）变没变。
2. `node scripts/shell-internals.mjs > /tmp/internals-new.txt`，和上一版 diff：
   **符号消失**比改名更早出现，而这一步是唯一能看见它的地方。
3. `./test/headless/run.sh all` —— 三个 flag 任一失效，这里第一次红（第 1 节第 2 条）。
4. `./test/prefs/run.sh` —— 设置窗是另一个进程，shell 侧全绿不代表它没坏。
5. `npm test` —— 五个纯模块 + 四个仓库守卫，其中 `test/shell-internals.test.js` 守第 3 节那条判据。
6. 真实会话：注销登录，读 journal 对基线（见 [reading-the-log.md](reading-the-log.md)、
   [baseline.md](baseline.md)）。headless 只能证明"不崩、不违例"，证不了"手感没变"。
7. 全绿之后再动 `metadata.json` 的 `shell-version`，然后才轮到 `version` 整数（见 AGENTS.md 的
   Release / version 一节 —— 整数不涨，用户就收不到更新）。

## 6. 已知未验证组合（别当成支持）

X11 会话；GNOME 48 / 49（本机只有 50.1，声明与验证的差就在这）；非 Ubuntu 发行版；
`database-backend` 的 `json` 与 `memory` 两个取值；GSound 音效；Soup 网络抓标题；
GStreamer 媒体时长；`libgda` 6.x。

这十条**不是待办**，是"下一次有人说这个扩展在某环境坏了"时最先查的十处。
