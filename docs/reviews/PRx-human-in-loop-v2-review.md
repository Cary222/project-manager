# Review Report: Human-in-Loop 重构 V2

> merged by Main (2026-07-27)

## 审查范围

| 文件 | 变更 | 审查维度 |
|------|------|----------|
| `features/ai/graph/agent.ts` | M | `resolvedEntities` 字段定义 |
| `features/ai/graph/nodes/human-confirmation.ts` | M | V2 重写，设置 `resolvedEntities` |
| `features/ai/graph/edges/routing.ts` | M | `routeAfterHumanConfirmation` 简化 |
| `features/ai/graph/nodes/search-structured.ts` | M | `resolvedEntities.user` 读取 |
| `features/ai/graph/nodes/generate-response.ts` | M | safety check 改读 `resolvedEntities` |
| `app/api/ai/conversations/[id]/messages/route.ts` | M | 删除 HTTP 层注入，清理死代码 |

---

## 双审查结论

### code-reviewer（硬层）

**最终判定：PASS**

- ✅ `resolvedEntities` Annotation reducer 正确
- ✅ 三路状态机（skip/valid/invalid）职责清晰
- ✅ HTTP `resolvedEntitiesResolved` 信号机制正确
- ✅ 双重降级路径均有 fallback
- ✅ V1 `confirmedUserId` 路径完全删除

**修复的 Critical：**
- `search-structured.ts` — `queryText!` 非空断言（改为默认值 `"(未指定)"`）
- `search-structured.ts` — `candidates!` 类型断言（改为 `Array.isArray` guard）

**修复的 Warning：**
- `generate-response.ts:204` — 链式访问改为局部变量
- `search-structured.ts` — `candidates` 数组 guard

**未修复（低优先级）：**
- console.log 前缀不统一（Warning #4 #5）— 不影响功能

### ai-learning-mentor（软层）

**最终判定：APPROVED**

- ✅ `resolvedEntities` 作为 SSOT 消除数据竞争
- ✅ 三字段职责清晰（pendingConfirmation / waitingForConfirmation / resolvedEntities）
- ✅ 两轮交互模型符合直觉
- ✅ 类型定义预留 project/ticket 扩展性

**建议改进（不阻塞合并，低优先级）：**
- `resolvedBy: "auto"` → `"extracted"`（语义更准确）
- 意图逃逸机制（用户输入完全无关问题时透传）
- 状态转换图 + 排查指南（辅助新人理解）

---

## 核心改动说明

### 问题根因

两个竞争数据来源：
- `toolResults.confirmedUserId` — HTTP 层维护
- `AIMessage.additional_kwargs.entityId` — 消息层携带

Graph 只读，但看不到任何一路写入，导致 `routeAfterHumanConfirmation` 误路由。

### 解决方案

**Single Source of Truth**：`AgentState.resolvedEntities`

| 字段 | 职责 | 写入者 |
|------|------|--------|
| `pendingConfirmation` | 持有候选列表 | `searchStructuredNode` |
| `waitingForConfirmation` | 控制路由是否绕道 humanConfirmation | `searchStructuredNode` / `humanConfirmationNode` |
| `resolvedEntities` | 最终解析结果（SSOT） | `humanConfirmationNode` |

### 数据流

```
第一轮：searchStructured → 多候选 → pendingConfirmation → generateResponse → "请选择"
第二轮：detectIntent → humanConfirmation(解析) → resolvedEntities → searchStructured → 真实回答
```

---

## tsc 检查

✅ `npm run build` — 通过

---

## 剩余风险（低）

1. **意图逃逸**：用户若在消歧流程中输入完全无关问题（如 `#10156`），会卡在消歧中。当前 `parseUserSelection` 返回 null，停留 `waitingForConfirmation: true`。
2. **console.log 残留**：多文件前缀不统一，不影响功能但影响可维护性。
