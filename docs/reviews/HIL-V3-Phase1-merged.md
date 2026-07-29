# HIL V3 Phase 1 合并审查报告

**merged by Main** — 2026-07-27

---

## 改动摘要

把 Human-in-Loop 从"用户消歧"扩展为"通用意图消歧引擎"。

| 文件 | 改动 |
|------|------|
| `agent.ts` | `PendingConfirmation` 泛化为 `type: "disambiguation"`, `entityType`; `resolvedEntities` 增加 `ticket/project/weekly_report` |
| `search-structured.ts (tool)` | `Attribution` 联合类型统一为 `DisambiguationAttribution`; `queryWeeklyReport` 返回消歧 attribution（修复 bug） |
| `search-structured.ts (node)` | 通用 HIL 检测逻辑，支持 entityType 阈值配置 |
| `human-confirmation.ts` | `parseSelection` 泛化为通用选择器，按 `entityType` 设置 `resolvedEntities` |
| `generate-response.ts` | 按 `entityType` 选择渲染模板（user/weekly_report/ticket/project） |
| `route.ts` | V2→V3 迁移函数，向后兼容旧格式 |
| `routing.ts` | `routeAfterHumanConfirmation` 支持所有实体类型 |

---

## 审查结论

### code-reviewer（硬层）

**CHANGES_REQUIRED → 全部修复 ✅**

| 级别 | 问题 | 状态 |
|------|------|------|
| Critical | `route.ts` V2 旧类型与新 `PendingConfirmation` 不兼容 | ✅ 已修复（迁移函数） |
| Warning | `routeAfterHumanConfirmation` 只检查 `resolvedEntities.user` | ✅ 已修复 |
| Warning | 非空断言 panic 风险 | ✅ 已修复（已有 entityType 分支） |
| Info | `DISAMBIGUATION_THRESHOLDS` 缺 `as const` | ✅ 已有 |
| Info | `UserDisambiguationAttribution` 旧类型残留 | ✅ 已删除 |
| Info | JSON.parse 无内层 try-catch | ⏭ 后续迭代 |
| Info | `resolveUser` N+1 查询 | ⏭ 后续迭代 |

### ai-learning-mentor（软层）

未产出报告（任务被中断）。

---

## 向后兼容验证

测试场景：`刘工的周报有哪些`

1. `detectIntent` → `mode=search`
2. `searchKnowledgeNode` → RAG 结果
3. `searchStructuredNode` → `queryUser` 返回多候选 → `pendingConfirmation` 设置
4. `generateResponseNode` → 渲染选择提示（user 类型）
5. **第二轮**：用户输入 `1`
6. `humanConfirmationNode` → `resolvedEntities.user` 设置
7. `routeAfterHumanConfirmation` → `searchStructured`（已支持所有 entityType）
8. `queryWeeklyReport` → 返回 cary 的周报 ✅

---

## 剩余工作

- **Phase 2**：多周报消歧（`queryWeeklyReport` 返回 >=3 份时触发）
- **Phase 3**：多工单/项目消歧
- **Info 类问题**：N+1 查询优化、JSON parse try-catch
