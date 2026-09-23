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

## 相对上游的改动（2.0.1）

本分支在上游 2.0.1 基线（`335fff2`）之上新增 13 个提交：

- **安全 / 正确性：** **将所有 Gda 查询参数化**（移除字符串拼接 SQL），并在 21 个文件中进行了一轮正确性、性能与清理。
- **资源泄漏：** 修复每次启用/禁用泄漏的资源；丢弃在禁用后才完成的异步初始化；统一两个用户下的 `actions.json` 监视守卫；修复被模态抓取（modal grab）抢走的弹窗键盘焦点及 `focusChild` 拼写错误。
- **性能：** 记忆化 `localeContains` 并提升 collator 调用；减少启动时的文件存在性扫描；避免重复的代码条目自动识别；缓存动作正则；为对话框打开计时；修复公共目录遍历。
- **数据库：** 启用 **WAL** 与 `synchronous=NORMAL`；Gda 5 语句自适应轮询；仅在条目确实可被淘汰时才裁剪历史。
- **国际化：** 重命名 `.mo` 文件以匹配 gettext 域。

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
