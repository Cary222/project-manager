<!-- reviewer: ai-learning-mentor (软层) -->

## 报销展示形式切换 — AI Mentor 软层审查

### 维度评估

| 维度 | verdict | 说明 |
|---|---|---|
| 需求对齐 | WARN | userId === null 跳过 vs 均分，用户意图需确认 |
| UX | PASS | 分段切换按钮清晰，keepPreviousData 防闪烁 |
| Accessibility | PASS | focus-visible ring 已加 |
| 缓存一致性 | MINOR | health-summary 5 分钟 TTL 较长但可接受 |
| Resilience | PASS | 空数据、空数组兜底均已实现 |

---

## 需求对齐问题

**用户原话**："某个单是有人员关联的，显示可能多次但金额应该均分"

**当前实现**：line 77 `if (!e.userId) continue;` — 跳过所有 userId 为空的报销记录。

**语义分析**：
- "金额应该均分" 说明多人报销时，金额需要分摊给每个关联人员
- 当前实现是"跳过"，即多人报销单不计入任何人的个人报销统计
- 这两个逻辑语义不同——均分会让总金额等于原始金额，跳过会让按人员统计的总金额小于实际报销总额

**建议**：向用户确认：
1. 多人报销单（userId 为空）是否计入统计？若计入，是否按人数均分？
2. 还是直接跳过（当前行为）？

**影响**：`summary.total` / `summary.count` 在两种方案下数值不同。

---

## 改进建议（优先级）

### Medium #1 — health-summary 缓存后 expense 数据陈旧

5 分钟 TTL 内 expense 数据更新不会反映在 summary 中。

建议：取消 expense 部分的缓存（`setCachedHealthSummary` 后置），或 expense 数据单独请求不缓存。

### Medium #2 — 人员视图缺少图表说明

`ReportsDashboard` 报销人员柱状图无 Legend，可加：

```tsx
<Legend wrapperStyle={{ fontSize: 12 }} />
```

---

## 通过项

- ✅ 切换按钮位置合理：紧贴「查看月报」左侧，不破坏现有布局
- ✅ 人员卡片有首字母头像 + 姓名 + 笔数 + 金额，信息完整
- ✅ `transition-all duration-200` 过渡平滑
- ✅ `keepPreviousData: true` 防止 tab 切换闪烁
- ✅ 空状态有友好提示

---

## 总体结论

**CHANGES_REQUIRED** — Critical: 需向用户确认"多人报销均分 vs 跳过"的业务语义。修复 Critical 后 APPROVED。