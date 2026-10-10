# 窗口化：门控、旋钮、以及会静默关掉它的东西

视口窗口化是本仓最大的结构改动，也是最容易被动失效的一层。这一节回答「这次改动之后窗口化还开着吗」。

> **来历**：从 `MAINTENANCE.md`（拆分前 520 行 / 12 节）搬来的第 6 节。搬动是逐字复制，
> 只有相对链接按新目录层级改写过。这个文件是这些事实的唯一主人，别在别处复述一遍。


## 6. 窗口化：门控、旋钮、以及会静默关掉它的东西

`ClipboardScrollContainer._materialized()` 只在**滚动轴上 item 尺寸均匀**时收窄窗口：

```
windowable = orientation != VERTICAL || !dynamic-item-height
```

所以：

- **`dynamic-item-height` 是窗口化的实际开关**（竖向时）。关掉 → 常驻 actor 从 255 降到 7–16；
  打开 → 完全退回旧行为，两条路径都有探针覆盖（`live` vs `unwindowed`）。
- **`item-height` 和 `clipboard-size` 是即时旋钮**，改它们**不需要**注销登录：
  `updateSize()` 监听 `changed::item-height`，容器也监听它做 `_syncWindow(true)` 重算窗口和 spacer。
  密度不够就先降 `item-height`（范围 50–1000），或升 `clipboard-size`（弹窗尺寸）。
  窗口化的 extent 用的是当前值，所以任何 `item-height` 下都精确。
- ⚠ **偏好设置里的 "Compact" 预设会把 `dynamic-item-height` 设回 `true`**
  （`lib/preferences/customization/profiles.js`），窗口化收益会**无声消失**。
  排查"怎么又卡了"，第一件事是 `dconf read /org/gnome/shell/extensions/copyous/dynamic-item-height`。
- 焦点条目滑出窗口时，key focus 交还搜索框，但 `_focusEntry` 保留 —— 下一次方向键会把它重新
  materialize 并滚回去。选中位置不丢，这是设计，不是 bug。
