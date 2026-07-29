<!-- merged by Main -->
# AI 查询意图重构 — 双审查合并报告

> 审查范围：F1 + F2 + F3（query-parser 重构 / decision 节点重命名 / HIL 路由统一）
> 审查轮次：v1（双审查已合入修复）
> 合并者：Main
> 配套报告：
> - 硬层：`docs/reviews/PRx-ai-decision-layer-code-reviewer.md`
> - 软层：`docs/reviews/PRx-ai-decision-layer-ai-mentor.md`

---

## 整体结论

| 维度 | 结论 |
|------|------|
| **Critical** | 3 项已修复（C1 tsc / C2 Branch 2 不触发 / C3 isAmbiguous 死循环） |
| **Major** | 4 项（暂留 future work，本 PR 不修） |
| **Minor** | 3 项（future work） |
| **跨审查共识** | 删除 `isAmbiguous` 字段（软层 #1 + 硬层间接关联）— **已落地** |
| **架构合理性** | 软层确认 decision 节点 133 行，职责薄，无过度工程化 |
| **学习价值** | 软层建议提炼 "Decision Layer Pattern" 笔记（待下个 PR） |

---

## Critical 修复对照表

| # | 问题 | 修复方式 | 修复位置 |
|---|------|---------|---------|
| **C1** | `query-weekly-report.ts` 缺 `relatedReportCount`（tsc 2322） | 两处 `attribution` 加 `relatedReportCount: 0` | `features/ai/core/queries/query-weekly-report.ts:62-74, 123-135` |
| **C2** | `routeAfterSearchStructured` 不读 `state.queryType="ambiguous"` → Branch 2 永不被触发 | 加 `if (state.queryType === "ambiguous" && !state.resolvedEntities) return "decision"` | `features/ai/graph/edges/routing.ts:140-164` |
| **C3** | `isAmbiguous` 消费即清机制缺失 → 修复 C2 后会触发 `decision → humanConfirmation → decision` 死循环 | 三道保险：① routing 判断加 `!resolvedEntities` 守卫；② decision Branch 2 加 `!resolvedEntities` 守卫；③ humanConfirmation 设 `resolvedEntities` 时同步 `queryType: null` | `routing.ts`, `decision.ts:80-118`, `human-confirmation.ts` |

---

## 软层 + 硬层共识合并

### 已落地（本次 PR）

- **软层 #1 + 硬层 #2 共识**：删除 `isAmbiguous` Annotation 字段，统一用 `queryType === "ambiguous"` 判断。软层理由（同一事实两个来源）+ 硬层理由（防止死循环）双重支持 → **落地**。
- **软层 #5（routing 加 "回炉" 注释）**：已顺手在 `routeAfterHumanConfirmation` 加一行注释说明多轮 HIL 路由意图。

### 暂留 future work（待下个 PR 讨论）

- **软层 #2 / 硬层 M3（routing.ts 仍调 `isUserActivityQuery`）**：计划要求"routing 只读 state"，但 `routeByMode` 仍调 query-parser 的 `isUserActivityQuery()`。这是为了"mode 决策用 state.queryType" 的渐进重构目标，本 PR 不强行修。
- **软层 #3（decision Branch 1/2 触发路径统一）**：将所有决策信号写入 `toolResult.decision` 让 decision 变纯读取者 — 属于 future architecture，下个 PR 评估。
- **硬层 M1 / M2**：detectIntent 早 return 路径 queryType 填充 + searchStructuredNode fallback 不一致。
- **硬层 M4**：`searchAmbiguousEntities` 并行 4 类无 timeout，建议加 `Promise.race(query, timeout(5000))`。
- **硬层 m1 / m2 / m3**：`queryType` 变量 unsafe cast / `extractedUser` 死状态 / `_viewerUserId` 未实现。

---

## 软层单独建议（学习线）

**软层 #6 建议提炼 "Decision Layer Pattern" 笔记：**

> 软层原文：在 `docs/learning/LangGraph-实战学习计划.md` 加 Day 12 —— Decision Layer Pattern。覆盖"HITL 决策暂停点"、"多轮 HIL 回炉"、"跨层状态传递"。

**Main 处理**：本次 PR 不写学习笔记（不在重构范围内），下个独立 PR 或下一次 LangGraph 学习 session 写。

---

## 修复后验证

### tsc（features/ai/graph + core 范围）

```bash
$ npx tsc --noEmit 2>&1 | grep -E "(features/ai/(graph|core))"
# 0 错误
```

### isAmbiguous 残留 grep

```bash
$ grep -r "isAmbiguous" features/ai/
No matches found
```

（`docs/reviews/*` 和 `.cursor/plans/*` 保留历史审查记录，按预期保留。）

### 防死循环三道保险

1. **routing.ts**：`queryType === "ambiguous" && !state.resolvedEntities` — Round 1 ambiguous → decision；Round 2 选完 → 跳出。
2. **decision.ts Branch 2**：新增 `!state.resolvedEntities` 守卫 — 即便 routing 被绕过也不会二次触发。
3. **human-confirmation.ts**：4 个分支设 `resolvedEntities` 时同步 `queryType: null` — 防多轮残留。

---

## 业务效果验证（手测清单）

按 `docs/plans/langgraph-测试用例_b2c7d3f1.md` 跑：

| 场景 | 预期 | 修复前实际 |
|------|------|-----------|
| "光污染传感器需求" | 走 Branch 2 → 展示 4 类候选 → 用户选 → 走对应类型查询 | 直接 note 查询返回 |
| "刘工的周报有哪些" | Round 1 选 user → Round 2 选 weekly_report → Round 3 返回详情 | OK（未坏） |
| "查询 #10081" | 直接 ticket 查询 → 返回详情 | OK（未坏） |

**重点手测**："光污染传感器需求" 是否触发候选选择（修复前是直接 note 查询）。

---

## 后续 PR 路线图

1. 软层 #6 — Decision Layer Pattern 学习笔记
2. 软层 #3 — decision 节点统一读 `toolResult.decision`
3. 硬层 M1-M4 — fallback 一致性 + timeout
4. 硬层 m1-m3 — 收尾清理

---

## 元信息

- 合并者：Main
- 修复者：fullstack-developer [5dfb561d]
- 硬层审查：code-reviewer [4a986a9b]
- 软层审查：ai-learning-mentor [6675a0ac]
- 修复时间：Wednesday, Jul 29, 2026, 10:21-10:35 (UTC+8)
