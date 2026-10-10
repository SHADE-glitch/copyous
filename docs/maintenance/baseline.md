# 当前基线：一组不许变差的数

L1 三臂与 L2 真实会话的实测数值。它不是成绩单，是**回归比对的分母** —— 改完跟这里比；哪些数能当判据见 [reading-the-log.md](reading-the-log.md)。（PLAN 的拆分映射表漏了这一节，按同一条理由单开成文件。）

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 11 节。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 11. 当前基线

**2026-10-07 更新 · 六探针三臂 18 个会话全跑：17 PASS + 1 正确 SKIP，0 条 CRITICAL / JS ERROR。**
（上一轮 2026-10-01 是五个探针 15 个会话，同一套结论，`39c5ea8` + 取消竞态修复。）

### L1 headless（fixture：255 行 / 5 pinned / `exclude-pinned` 下 250 可见）

| 指标 | `live`（窗口化） | `unwindowed` | `horizontal`（窗口化） |
| --- | ---: | ---: | ---: |
| 填充后常驻 actor | 3 | 255 | 3 |
| 走完全列表的常驻峰值 | 10 | 255 | 16 |
| 填充后 RSS | 254 MB | 319 MB | 251 MB |
| 走完 + 回顶后 RSS | 291 MB | 379 MB | 289 MB |
| 滚动一屏中位 | 20.2 ms | 1.4 ms | 28.7 ms |
| 滚动一屏最差 | 181.4 ms | 2.5 ms | 185.4 ms |
| extent 容差 | 0 px（精确） | n/a | 30 px（已知，见 [open-items.md](open-items.md)） |
| 探针结果 | 5/5 PASS | 4 PASS + 1 SKIP | 5/5 PASS |

extent A/B（同一会话内强制全量再收回，唯一变量是 actor 数）：竖向 `upper` 恒为 **46398** =
255×170 + 254×12，七个滚动位置全一致；RSS 在全量峰值 377 MB，收回窗口后 359 MB。
**能回落一点，但别把 RSS 当活集用**（见 [cost-measurement.md](cost-measurement.md)）。

搜索等价：每臂 6630 次全量比对 + 2550 次增量比对，**0 不一致**。

### L2 真实会话（2026-10-07 22:01 登录，PID 101341）

```
loaded 255 entries in 371.126ms
filled 255 entries in 151.381ms      ← 窗口化前同机同库：1262 / 1390 / 1422 / 1434ms
warmup took 11.688ms
shell: Rss 359MB  Swap 24MB  majflt 60     全机 swap: 599MB / 15258MB
本会话 CRITICAL/JS ERROR: 1 条，且是别的扩展的 firstIcon（跨 boot 已出现 11 次），
                          与本仓库无关；竞态特征（line_wrap / already disposed）0 条。
```

对照 2026-10-01 那个**未窗口化**的会话：`filled 1262–1434ms`、`Rss 570MB`、`Swap 915MB`、
`majflt 133176`、全机 swap 9312MB。**会话年龄不同（19 分钟 vs 数天），这组对比只能当方向看，
不能当判据**（见 [cost-measurement.md](cost-measurement.md)）。真实会话 `page_size` 是 535px，headless 是 378px，所以每屏条目数与
窗口大小两边不可比。

### 体验面（probe 06，两次独立运行数值一致）

窗口化把**建行成本从启动搬到了滚动路径上**。这是本轮量出来的最大一项，也是唯一一项用户能
直接感觉到的代价：

| | 窗口化（`live`） | 未窗口化（`unwindowed`） |
| --- | ---: | ---: |
| 一整趟滚动新建行数 | ~83 步 × 每步 2 行 | 0（全在填充时建好了） |
| 一整趟的建行耗时 | **~1000 ms** | 0 ms |
| 单步最差 | **182–190 ms** | 1.5–2.5 ms |

按类型分解建行耗时（每类型独立统计，两次运行一致）：

| 类型 | 建行次数 | 均值 | 最差 |
| --- | ---: | ---: | ---: |
| Text | 498 | 3.0 ms | 7.1 ms |
| **Code** | 195 | **7.4 ms** | **121.6 ms** |
| Link | 9 | 4.5 ms | 9.4 ms |
| Image / File / Files | 45 | 3.3–3.6 ms | ≤ 6.0 ms |

**Code 行的均值是 Text 的 2.4 倍，最差单次 121–133 ms（约 7 帧）**。所以"滚过一段代码历史时
顿一下"是真实存在的，不是错觉；未窗口化时同样的成本发生在启动填充里，人不觉得。
缓解方向（都还没做，等定）：给 Code 行单独加大 overscan、或把高亮推迟到绘制之后。

其余六项**都是好消息，说明没有隐藏的体验问题**：

- **滚动期间 DB 写 0 次**（三臂一致）。曾担心 `CodeItem` 惰性探测语言 → `notify::metadata` →
  `updateProperty` 会把写库挪到滚动时，实测没有发生。
- **选中项从不在还可见时被销毁**：窗口是 `[first-rows, first+2·rows+1)`，可见行是
  `[first, first+rows]`，四轴 × 每轴 7 个视口位置逐一验证，0 例。
- **一次动画聚焦建行 0 个** —— 不反复建了再扔。
- **滚动条滑块尺寸竖向完全恒定**（相对散布 0%）；横向 0.026%，即 24px 滑块上 0.006px，
  来自 [open-items.md](open-items.md) 那条已知的 15px/端 extent 偏差。
- **pin 一行不会让它当场消失**（`notify::pinned` 不触发重过滤）。但注意：`exclude-pinned=true`
  下它会在**下一次搜索按键时**消失 —— 这是上游行为，不是本分支引入，用户可能觉得意外。
- 空历史（新装机的初始态）正常：显示 Empty 态、0 建行、无游离子节点。
- **RSS 会随滚动趟数上涨，但窗口化涨得更少**：三趟全列表下来，窗口化 290→296→314MB
  （+24MB），未窗口化 391→416→437MB（+46MB，且起点就高 100MB）。所以"反复滚动会不会把内存
  越滚越大"这个担心，方向上是反的 —— 未窗口化那条也在涨，而且涨得更多。


### 这套验证抓到过什么（留证，说明它值这个维护成本）

- **`FileItem` / `LinkItem` 的 await-之后-写已销毁 actor 竞态**：`configureFilePreview()` 在
  `await getFileType()` / `await tryCreateFilePreview()` 之后不检查 `_cancellable`，直接
  `insert_child_above` 并调 `configureVisibility()`，而后者写 `this._file.clutter_text.line_wrap`
  —— label 已 dispose，`clutter_text` 为 null，抛 `TypeError` 并刷一串 `St.Label … has been
  already disposed`。`LinkItem` 的 `await tryGetMetadata()` 之后同样裸写
  `this._linkPreview.metadata`。`destroy()` 早就 `cancel()` 了，只是没人查。
  **这是窗口化把一个原本只在清空/删除时偶尔发生的竞态，变成了滚动与搜索时持续发生** ——
  首轮 9 条 CRITICAL，加守卫后 0 条。
- harness 自身的两个坑：探针里用 `Math.round` 而代码用 `Math.ceil` 算视口数，阈值差一屏就假红；
  以及 fixture.db 被当会话库直接用，15 个会话把行数从 255 磨到 250，重跑不再幂等。
