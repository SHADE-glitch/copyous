<p align="right"><a href="INVARIANTS.md">English</a> | <a href="INVARIANTS.zh-CN.md"><b>简体中文</b></a> · <a href="README.zh-CN.md">README</a></p>

# 不变量 —— 别把这些"修"回去

这是一个**指针文件**。它只记两件事：哪些地方看着像错、但必须继续错着，以及证据在谁手里。
它刻意不装任何"另一个文件已有主人"的散文 —— 事实的第二份拷贝会烂掉，原本那份才是权威。

行为变化的权威是 [CHANGELOG.md](CHANGELOG.md)，不是这里。要把记录在案的修复读出来，
让机器从记录里打印，而不是抄进本文件：

```sh
node scripts/check-log.mjs --invariants     # 每一条 kind:fix，连着它的提交
```

## 1. 看着像错、必须继续错的

| 看着像错 | 为什么保持 | 在哪查 |
|---|---|---|
| `shell-version` 声明 `"48","49","50"`，而本机只跑过 50.1 | 有意的安全闸：不匹配就不加载，也好过半死不活地跑。没验证过就不加新大版本，也别为了让声明"诚实"而删掉一个 | [docs/maintenance/compatibility-matrix.md](docs/maintenance/compatibility-matrix.md) 第 2、6 节 |
| `version-name` 还写着 `2.0.1`，尽管 fork 已经有自己的改动 | 它是 fork 冻结的上游基线号。改编号是维护者拍板的事，不是清理项 | `metadata.json`；AGENTS.md「Release / version」 |
| `paste-on-copy` 是真实存在的键，设置窗里却没有行 | `migrateSettings()` 已经把它折进 `swap-copy-shortcut` 并 reset；再给个控件等于提供一个不再有意义的偏好 | `node scripts/settings-coverage.mjs` —— 它是**唯一**被允许的"无控件"键 |
| 4 个键名跨子 schema 重名（`text-count-mode`、`syntax-highlighting`、`show-line-numbers`、`background-size`） | 它们属于不同的条目类型。任何"批量恢复默认"如果走一张扁平的 键名→默认值 表，会静默重置错的 schema | `node scripts/settings-coverage.mjs`；`lib/common/settings.js` 的嵌套结构 |
| `theme.gresource` 与 `resources.gresource` 是提交进仓库的编译产物，树里没有源码 | 本扩展没有构建步骤，也不许引入。视觉改动等于引入工具链；那些产物**能读不能改** | [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) 第 1 节 |
| `lib/misc/actor.js` 运行时无人 import | 删它要连带删测试套和三处文档引用，属 churn 且无疼痛证据；留着是零成本 —— ESM 只加载被 import 的模块 | README 的有意未修清单；`test/actor.test.js` |
| 设置行右侧的 undo 按钮在默认值时**灰着可见**，而不是隐藏 | 隐藏会让 `test/prefs/run.sh` 在 memory 后端下数不到按钮，覆盖证明就只剩静态门一家。两道门是分工，不是冗余 | `./test/prefs/run.sh` + `node scripts/settings-coverage.mjs` |
| 没有「恢复本页默认」也没有「全部恢复默认」 | 79 个控件已经逐个有回到默认的路。页级按钮是把 20 次精确 undo 换成 1 次不可逆批量写 —— 而 live 配置改得很深 | [docs/maintenance/open-items.md](docs/maintenance/open-items.md) |
| 复制图片仍会把主线程钉住一次，约 24–46ms | 两趟全量解码已经压成一趟；gdk-pixbuf 要到 `close()` 才 inflate。再往下只剩两条路：通知里不放预览（=删功能），或起子进程解码（=新机制）。两条都要拍板 | [docs/maintenance/open-items.md](docs/maintenance/open-items.md)；探针 10 |
| 横向列表窗口化时 `upper` 每端少 15px | 主题里 `:first-child`/`:last-child` 的 margin 落在窗口外造成的。吸收它要么把主题常量硬编码进 JS，要么挪伪类 —— 后者会开出一条随滚动往下爬的可见空隙。占 extent 的 0.01% | README 的有意未修清单 |
| `DATABASE_VERSION` 一个后端是 3、另一个是 2 | 两个互不相干的格式版本撞了名。不是缺陷，别去"统一" | 静态 |
| `custom-color-scheme=high-contrast` 没有对应 template | 控件根本不给你选这一项，代码还 `Math.min` 夹住了，只有手写 gsettings 能触发。已记录，有意不修 | README 的有意未修清单 |

## 2. 量过并且已否决的设计 —— 别复活

- **比例型性能闸门。** 同一份代码三次跑出 1.3 / 1.57 / 1.72，在这种散布上设阈值只会制造假红。
  见 [docs/maintenance/cost-measurement.md](docs/maintenance/cost-measurement.md) 第 4 节。
- **增量 PNG 解码**（把一张图解摊进主循环缝隙）：每片 0.5–0.9ms，然后 `close()` 一次 62ms。
  进程内摊不开。
- **"视口感知"的渐进揭示**：换几十 ms 的后台 CPU，代价是同时动三条计数路径，失败模式是
  "滚下去是空白"。这条已被窗口化取代 —— 窗口化下整条揭示直接早退。
- **给那 46 个私有符号做 `lib/shell/` 门面。** 没有疼痛证据，而且会把和动画、时序耦合在一起的
  调用拆到两个文件里。替代措施是清单本身：
  [docs/maintenance/shell-internals.md](docs/maintenance/shell-internals.md) 第 5 节。
- **"reset 按钮挂错行"那条判据。** 12 条假警报 —— 复合行本来就能一行管多键。已经撤掉，别加回来；
  真正干活的是 `settings-coverage.mjs` 里的键级不变式。
- **模块级的搜索记忆表。** 已修（改成实例持有），守卫是探针 09；列在这里只因为下一次"优化"
  很可能又伸手去拿模块单例。

## 3. 什么不能为了指标换掉

维护者定的优先级：**稳定性 > 性能 > 外观。** 为改善一个数字而删功能，不叫优化，叫换成另一个产品。
可恢复的状况一律 `logger.warn` —— `logger.error` 会被打成 shell CRITICAL，把健康闸门永久染红，
于是一次合法的一次性事件就变成修不掉的假警报。完整规则清单在 [AGENTS.md](AGENTS.md)。
