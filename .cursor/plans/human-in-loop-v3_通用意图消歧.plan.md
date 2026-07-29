# Plan: Human-in-Loop V3 — 通用意图消歧

## 现状（V2）

Human-in-Loop 目前只在**用户多候选**场景触发：
- `queryUser` / `queryWeeklyReport` 返回 `attribution.candidates` → `searchStructuredNode` 检测到 `>1` → 设 `pendingConfirmation` → `generateResponse` 渲染选择提示

**局限**：只处理"哪个用户"这一种消歧，无法覆盖其他多结果场景。

## 用户期望的 V3 场景

### 场景 1：多用户消歧（已有）
```
User: "刘工的周报"
→ queryUser 返回 [cary, 刘屹鹏(usr test)]
→ HIL 弹窗：选择目标用户
→ User: "1"
→ 查询 cary 的周报
```

### 场景 2：多周报消歧（新）
```
User: "刘工的周报有哪些"
→ 已消歧到 cary
→ queryWeeklyReport 返回多份周报
→ HIL 弹窗：选择具体哪份周报
→ User: "第2份" 或 "最近那份"
→ 返回选定周报详情
```

### 场景 3：多工单消歧（新）
```
User: "cary 最近的工单"
→ queryTicket 返回多个结果
→ HIL 弹窗：选择目标工单
→ User: "3"
→ 返回 #10193 详情
```

### 场景 4：多项目消歧（新）
```
User: "给我看看光污染相关的项目"
→ queryProject 返回多个项目
→ HIL 弹窗：选择目标项目
→ User: "2"
→ 返回项目详情
```

## 核心设计原则

| 原则 | 说明 |
|------|------|
| **意图优先** | 触发 HIL 的不是"数据结构有多条"，而是"AI 不确定用户想要哪一条" |
| **可配置阈值** | 每个查询类型有自己的阈值（用户=1，工单≥3，周报≥3，项目≥3） |
| **候选渲染可定制** | 不同实体类型渲染格式不同（用户=序号+名字，工单=序号+标题，周报=序号+日期） |
| **支持自然语言选择** | "第2个"、"最近那份"、"最新的那个"都能解析 |
| **可跳过** | 用户可以输入 skip/0 放弃选择，系统给出概览或第一项 |

## 架构改动

### 1. 统一 PendingConfirmation 类型

```typescript
// agent.ts
interface PendingConfirmation {
  type: "disambiguation";
  entityType: "user" | "ticket" | "project" | "weekly_report";
  candidates: CandidateItem[];
  query: string;
  // 用于渲染的原始数据（searchStructured.execute 返回的完整 result）
  sourceResult: unknown;
}

interface CandidateItem {
  id: string;
  label: string;       // 渲染用：例如 "1. #10193 新wifi相机的模版"
  summary: string;     // 简短描述：例如 "状态: DEVELOPING，2小时前更新"
}
```

### 2. searchStructured 返回结构统一化

每个查询函数在返回多结果时，都应返回带候选的 attribution：

```typescript
// 统一的 attribution 结构
attribution: {
  kind: "disambiguation";
  entityType: "user" | "ticket" | "project" | "weekly_report";
  candidates: CandidateItem[];
  count: number;          // 用于判断是否超过阈值
  threshold: number;       // 该类型的阈值
}
```

### 3. searchStructuredNode 统一检测逻辑

```typescript
// 不再只检查 user 类型，改为通用逻辑
const attribution = (result as { attribution?: Attribution })?.attribution;
if (attribution?.kind === "disambiguation" &&
    attribution.candidates.length >= thresholds[attribution.entityType]) {
  return {
    pendingConfirmation: {
      type: "disambiguation",
      entityType: attribution.entityType,
      candidates: attribution.candidates,
      query: queryText,
      sourceResult: result,
    },
    waitingForConfirmation: true,
    originalQuery: content,
  };
}
```

### 4. humanConfirmationNode 扩展选择解析

```typescript
// 支持多种选择格式
parseSelection(input: string, candidates: CandidateItem[]): string | null | "skip" {
  // 1. 数字选择："1", "2", "3"
  // 2. 自然语言："最近那份", "最新的", "第二个"
  // 3. 名称/ID 匹配：工单号、标题关键词
  // 4. skip："0", "取消", "skip"
}
```

### 5. generateResponseNode 统一消歧渲染

```typescript
// 根据 entityType 选择渲染模板
function renderDisambiguationPrompt(
  entityType: string,
  candidates: CandidateItem[],
  query: string
): string {
  switch (entityType) {
    case "user": return renderUserDisambiguation(candidates, query);
    case "ticket": return renderTicketDisambiguation(candidates, query);
    case "project": return renderProjectDisambiguation(candidates, query);
    case "weekly_report": return renderWeeklyReportDisambiguation(candidates, query);
  }
}
```

### 6. confirmedEntities 扩展为数组

```typescript
// agent.ts - resolvedEntities 支持多个已确认实体
resolvedEntities: Annotation<{
  user?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  ticket?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  project?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  weekly_report?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
} | null>
```

## 改动文件

| 文件 | 改动内容 |
|------|----------|
| `agent.ts` | `PendingConfirmation` 泛化、`resolvedEntities` 支持多实体 |
| `human-confirmation.ts` | `parseSelection` 支持工单/项目/周报的自然语言解析 |
| `search-structured.ts` | 统一 `attribution.kind = "disambiguation"` 返回结构 |
| `search-structured.ts (node)` | 通用 HIL 检测逻辑，移除 user 类型硬编码 |
| `generate-response.ts` | 按 entityType 选择渲染模板 |

## 分阶段实施

### Phase 1：基础设施（不影响现有功能）
- [ ] 统一 `Attribution` 类型，支持 `disambiguation` kind
- [ ] `searchStructuredNode` 改为通用检测（保留 user 类型现有逻辑）
- [ ] `generateResponseNode` 按 entityType 渲染

### Phase 2：多周报消歧
- [ ] `queryWeeklyReport` 返回 `attribution.disambiguation`（>=3份周报时）
- [ ] `parseSelection` 支持"最近"/"第N个"等自然语言

### Phase 3：多工单/项目消歧
- [ ] `queryTicket` / `queryProject` 返回 `attribution.disambiguation`
- [ ] 阈值配置化

### Phase 4：自然语言选择增强
- [ ] "最大的那个项目"、"最新的工单"等语义解析
- [ ] 意图逃逸：用户输入完全无关问题时透传

## 验证步骤

1. `npm run build` — tsc 通过
2. 场景 1（多用户）：`刘工的周报有哪些` → 选择 → 回答 ✅（现有）
3. 场景 2（多周报）：`刘工的周报有哪些` → 选择用户 → 看到多份周报 → 选择 → 详情
4. 场景 3（多工单）：`cary 最近的工单` → 多结果 → 选择 → 详情
