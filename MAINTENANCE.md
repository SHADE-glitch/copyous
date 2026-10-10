# copyous@local 维护清单

本仓库是上游 [Copyous](https://github.com/boerdereinar/copyous) 2.0.1 冻结后的本地维护分支，
没有构建步骤，直接从 `~/.local/share/gnome-shell/extensions/copyous@local` 运行。

这份文件是**路由器**：只回答「这个问题去哪个文件」，外加三样没有别的家的东西（三十秒速查、
代码加载规则、环境残留清理）。正文都在 `docs/maintenance/` 下，一条事实只有一个主人 ——
以前这里 520 行 12 节，改一次要滚三屏，现在拆了。

"改了什么、为什么改"看 [README.zh-CN.md](README.zh-CN.md#-相对上游的改动201) 的分歧清单（权威）；
给 agent 的硬规则看 [AGENTS.md](AGENTS.md)。三处不重复，避免漂移。

---

## 问题 → 文件

一条事实只有一个主人。下表是唯一入口；找不到自己的问题就先写进这里，再落到某个文件，
否则下个会话又会造出第二份。

| 问题 | 文件 |
| --- | --- |
| 改之前跑什么、按什么顺序、隔离边界在哪、headless 能证明什么 | [docs/maintenance/verification.md](docs/maintenance/verification.md) |
| journal 怎么读、哪些字段能当回归判据、哪些是噪声 | [docs/maintenance/reading-the-log.md](docs/maintenance/reading-the-log.md) |
| RSS / 滚动 / CPU 成本的口径（两个数怎么才能比） | [docs/maintenance/cost-measurement.md](docs/maintenance/cost-measurement.md) |
| 窗口化的门控与旋钮、什么会**无声**关掉它 | [docs/maintenance/windowing.md](docs/maintenance/windowing.md) |
| 剪贴板历史：落盘位置、权限、备份、增长分层 | [docs/maintenance/database.md](docs/maintenance/database.md) |
| 平台需求、GNOME 大版本升级检查单 | [docs/maintenance/compatibility-matrix.md](docs/maintenance/compatibility-matrix.md) |
| 用了哪些 Shell 内部实现、升级时最先断的线 | [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) |
| 当前基线：一组不许变差的数 | [docs/maintenance/baseline.md](docs/maintenance/baseline.md) |
| 已知不修 / 等你拍板 | [docs/maintenance/open-items.md](docs/maintenance/open-items.md) |
| 改了什么、为什么改（逐条带 commit） | [CHANGELOG.md](CHANGELOG.md) |
| 有意与上游的分歧（权威清单） | [README.zh-CN.md](README.zh-CN.md#-相对上游的改动201) |
| 给 agent / 人的硬规则 | [AGENTS.md](AGENTS.md) |
| 哪些看着像错、必须继续错 | [INVARIANTS.md](INVARIANTS.md)（中英各一份） |
| 会话状态：进度、决定、待办 | `docs/reports/STATE.md` —— **本地文件，不入库**（里面引用了原始 journal 行与真实配置值），所以 clone 下来看不到 |

**引用规则**：别处指这些内容时**指文件，不指章节号**。"`MAINTENANCE.md` + 章节号"这种写法
已经全部作废 —— 它指向的是拆分前那个 520 行的文件，而现在那些正文在各主题文件里。
这条有守卫，写在 `test/repo.test.js`：整棵已发布树（`docs/reports/` 那些按日期冻结的记录除外）
里**不许再出现章节号那个符号**，且 `docs/maintenance/` 里每个文件都必须被上面这张表链接 ——
范围由目录自身推导，没有白名单，所以新加一个主题文件而忘了链接它，本身就是红的。

---

## 0. 三十秒速查

| 我要做的事 | 先跑 |
| --- | --- |
| 改了 `lib/common/{color,glob,settings}.js` 或 `lib/misc/actor.js` | `npm test`（秒级，不需要 shell） |
| 改了 `lib/preferences/**`（设置窗） | `./test/prefs/run.sh && node scripts/settings-coverage.mjs`（秒级，**不需要注销**，不碰 dconf） |
| 动了 `schemas/*.xml`（加键、改默认值、改范围） | `node scripts/settings-reference.mjs --write`（README 的键表是生成物，不写它就过期）→ 再跑上面那条 |
| 改了任何 `lib/ui/**`、`extension.js` | `./test/headless/run.sh live`（分钟级，会抢 CPU） |
| 改了滚动 / 过滤 / 焦点相关 | `./test/headless/run.sh all`（三臂全跑） |
| 动了 `gi://` 依赖，或新增了 typelib 用法 | `node scripts/shell-internals.mjs`（秒级；口径见 [shell-internals.md](docs/maintenance/shell-internals.md) 与 [compatibility-matrix.md](docs/maintenance/compatibility-matrix.md)） |
| 想知道扩展空转费不费 CPU | `./test/headless/idle-cost.sh 45 2`（约 10 分钟；读数前的丢弃窗口不能省，见 [cost-measurement.md](docs/maintenance/cost-measurement.md)） |
| 想确认某个性能结论在真实会话成立 | 注销登录 → 见 [reading-the-log.md](docs/maintenance/reading-the-log.md) 的 PID 取法 → 读 journal |
| 怀疑有残留进程在干扰测量 | `./test/headless/down.sh` |

---

## 2. 代码加载规则（最容易自欺的一条）

`gnome-extensions disable && enable` **不会**重新 import 任何 `lib/*.js`。GJS 按 `file://` URI
缓存 ESModule，整个 shell 生命周期内不失效，Wayland 上也没有 `--replace`。

所以：**改完代码，不注销登录，journal 里看到的就是旧行为。** 不要据此判断"改动没效果"或
"改动没生效"。要么注销登录，要么用 `test/headless/`（它每次起新进程，加载的是磁盘上的当前内容）。

*这条的"不许"写在 [AGENTS.md](AGENTS.md) 的 Critical Rules（那里是规则的主人）；本节只负责解释
它为什么会这样，以及该用哪个面去避开它。*

---

## 9. 环境残留清理

`run.sh` 用 `trap` 收尾，但崩溃或被外部杀掉时会留下一个占 ~230MB 的 headless shell，
而它会让 [reading-the-log.md](docs/maintenance/reading-the-log.md) 的 PID 取法读到错的进程。

```sh
./test/headless/down.sh          # 幂等，按 pidfile + 特征串清
pgrep -af "wayland-copyous-harness"   # 应该是空的
```
