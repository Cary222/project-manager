---
name: AI Agent Platform 实施方案（三层 Agent Profile）
overview: 废弃「Work Mode」单一概念，重构为 Agent Platform，支持三种 Agent Profile：Conversation Agent（LangGraph）、Coding Agent（Agent Loop + 4 工具）、Business Agent（LangGraph Workflow）。共享 Runtime（LLM Provider / Tool Registry / Memory / Tracing），UI 层通过 Agent Profile 切换。
todos:
  - id: runtime-foundation
    content: "Agent Runtime 基础设施：Tool Registry + LLM Provider 共享"
  - id: coding-agent
    content: "Coding Agent：Agent Loop + read/write/edit/bash 四工具（Pi 风格）"
  - id: chat-agent-refactor
    content: "Conversation Agent：重构为独立 Profile，保留现有 LangGraph StateGraph"
  - id: business-agent
    content: "Business Agent：LangGraph Workflow + 业务工具（searchStructured / writeReport）"
  - id: profile-switch-ui
    content: "UI 层：Profile 切换（Chat / Coding / Business）"
  - id: archive-old-workflow
    content: "归档旧 features/ai/workflow/"
---
# Plan: AI Agent Platform 实施方案（三层 Agent Profile）

## 架构总览

```
                    ┌─────────────────────────────────────────┐
                    │           Agent Platform                │
                    │                                       │
                    │   ┌─────────────────────────────────┐ │
                    │   │       Agent Runtime             │ │
                    │   │                                 │ │
                    │   │  • Tool Registry (分层)        │ │
                    │   │  • LLM Provider (统一)         │ │
                    │   │  • Memory / Session           │ │
                    │   │  • Tracing                    │ │
                    │   └────────────┬──────────────────┘ │
                    │                │                      │
                    │      ┌─────────┼─────────┐          │
                    │      ▼         ▼         ▼          │
                    │ ┌──────────┐┌──────────┐┌──────────────┐│
                    │ │Conversation││  Coding  ││   Business   ││
                    │ │   Agent    ││   Agent  ││    Agent    ││
                    │ └─────┬─────┘└────┬─────┘└──────┬──────┘│
                    │       │            │              │       │
                    │ ┌─────▼─────┐┌────▼────┐┌──────▼──────┐│
                    │ │StateGraph ││AgentLoop││ StateGraph ││
                    │ │LangGraph  ││ (while)  ││  LangGraph ││
                    │ └─────┬─────┘└────┬─────┘└──────┬──────┘│
                    │       │            │              │       │
                    │ ┌─────▼─────┐┌────▼────┐┌──────▼──────┐│
                    │ │ Business   ││OS Tools ││ Business    ││
                    │ │ Tools      ││read/wri ││ Tools       ││
                    │ │search/SQL ││te/edit/ ││searchStruct ││
                    │ │RAG/Web     ││bash     ││writeReport ││
                    │ └───────────┘└─────────┘└─────────────┘│
                    └─────────────────────────────────────────┘
```

### 三种 Agent 的本质区别

| | Conversation Agent | Coding Agent | Business Agent |
|---|---|---|---|
| 运行时 | LangGraph StateGraph | 纯 Agent Loop（while） | LangGraph StateGraph |
| 流程控制 | **程序控制**：节点路由，HIL 中断 | **LLM 控制**：模型决定下一步 | **程序控制**：定时/事件触发 |
| 工具集 | searchStructured / SQL / RAG / WebSearch | read / write / edit / bash | searchStructured / writeReport / notify |
| 触发方式 | 用户对话 | 用户明确进入 Coding 模式 | Scheduler / Event |
| 生命周期 | 实时，秒级 | 分钟～小时 | 小时～天 |
| HIL 支持 | 原生（interrupt） | 扩展实现 | 原生（interrupt） |

## 核心设计原则

### 1. 工具集严格隔离

**错误做法**（工具污染）：
```ts
// Chat Agent 的工具列表混入 bash
tools: [searchStructured, bash, RAG]  // ❌
```
后果：用户问"刘工最近干什么"，LLM 可能调用 `bash grep 刘工`。

**正确做法**（Profile 隔离）：
```ts
ConversationProfile: { tools: [searchStructured, sql, RAG, webSearch] }
CodingProfile:      { tools: [read, write, edit, bash] }
BusinessProfile:    { tools: [searchStructured, writeReport, notify] }
```

### 2. Unix Philosophy（Pi 的 4 工具）

> 工具越少，Agent 行为空间越稳定。

Coding Agent 只有 4 个工具：
- 搜索：`bash` + `grep/rg/find`
- 编辑：`edit`（精确 oldText 替换）
- 创建：`write`
- 执行：`bash`

所有复杂操作由工具组合实现。

### 3. Runtime 共享，执行器独立

```
Agent Runtime（共享）
├── Tool Registry（分层：OS层 / Business层）
├── LLM Provider（统一接口）
├── Memory / Session
└── Tracing

          ↓ 调用同一 Runtime
          
┌──────────┬──────────┬──────────┐
│Conversation│  Coding  │ Business │
│ GraphExec  │ LoopExec │ GraphExec│
└──────────┴──────────┴──────────┘
```

## 目录结构

```
features/ai/
├── runtime/                          # 共享 Runtime（不变，新建设施）
│   ├── tool-registry.ts             # 工具注册表（按 Profile 分层）
│   ├── llm-provider.ts              # 统一 LLM 调用
│   ├── session.ts                   # Session / Memory
│   └── tracing.ts                   # Tracing
│
├── agents/                           # Agent Profiles（新目录）
│   ├── conversation/                # Conversation Agent（重构）
│   │   ├── executor.ts              # LangGraph executor
│   │   ├── graph.ts                # StateGraph 定义
│   │   ├── state.ts                # ConversationState
│   │   └── tools.ts                # 业务工具集
│   │
│   ├── coding/                     # Coding Agent（新建，Pi 风格）
│   │   ├── executor.ts             # Agent Loop executor
│   │   ├── agent.ts               # WorkModeAgent（已有，重构）
│   │   ├── tools/
│   │   │   ├── read.ts           # ✅ 已有
│   │   │   ├── write.ts          # ✅ 已有
│   │   │   ├── edit.ts           # ✅ 已有
│   │   │   ├── bash.ts           # ✅ 已有
│   │   │   └── index.ts          # ✅ 已有
│   │   └── state.ts              # CodingAgentState
│   │
│   └── business/                   # Business Agent（重构现有 workflow）
│       ├── executor.ts             # LangGraph executor
│       ├── graph.ts               # StateGraph
│       ├── state.ts               # BusinessState
│       └── tools.ts               # 业务工具集
│
├── graph/                          # 现有 → 迁移到 agents/conversation/
│
├── workflow/                       # 现有 → 迁移到 agents/business/（归档）
│
├── llm/                           # 现有（不动）
│
└── ui/
    ├── AgentProfileSwitcher.tsx  # ⬜ Profile 切换 UI
    ├── coding/                   # ⬜ Coding 模式 UI
    │   ├── ToolCallCard.tsx
    │   └── AgentStatus.tsx
    └── ...
```

## 第一阶段交付（Stage 1）

### Stage 1.1 — Coding Agent 核心（已完成核心）

**已实现**：
- `features/ai/work-mode/agent.ts` → 迁移到 `features/ai/agents/coding/agent.ts`
- `features/ai/work-mode/tools/` → 迁移到 `features/ai/agents/coding/tools/`
- `features/ai/work-mode/session-manager.ts`
- `features/ai/work-mode/events.ts`
- `features/ai/work-mode/system-prompt.ts`
- `app/api/ai/work-mode/` → `app/api/ai/agents/coding/`

**待修复**：
- TypeScript 错误：`callAgnesStream` 不存在 → 改用 `streamText`（子代理正在修复）

### Stage 1.2 — Agent Runtime 基础设施

**新增**：
- `features/ai/runtime/tool-registry.ts`（工具注册，按 Profile 分层）
- `features/ai/runtime/llm-provider.ts`（统一 LLM 调用）
- `features/ai/runtime/session.ts`（Session 管理层）

**工具注册设计**：
```typescript
const TOOL_REGISTRY = {
  conversation: [searchStructuredTool, sqlTool, ragTool, webSearchTool],
  coding:        [readTool, writeTool, editTool, bashTool],
  business:      [searchStructuredTool, writeReportTool, notifyTool],
} as const;

function getToolsForProfile(profile: AgentProfile): AgentTool[] {
  return TOOL_REGISTRY[profile].map(def => def.factory());
}
```

### Stage 1.3 — Conversation Agent 重构

**目标**：将现有 `features/ai/graph/` 重构为 `agents/conversation/`
- 独立 StateGraph
- 接入 Runtime（共享 Tool Registry / LLM Provider）
- 保留现有 7 节点路由逻辑

### Stage 1.4 — Business Agent（重构现有 workflow）

**目标**：将现有 `features/ai/workflow/` 重构为 `agents/business/`
- LangGraph StateGraph
- 接入 Runtime
- 保留周报生成等场景

### Stage 1.5 — UI Profile 切换

**新增**：
- `features/ai/ui/AgentProfileSwitcher.tsx`（模型选择旁滑块）
- `features/ai/ui/coding/ToolCallCard.tsx`
- `features/ai/ui/coding/AgentStatus.tsx`

**Profile 切换 UI**：
```
[模型选择]  [🔄 Chat] [⌨️ Coding] [⚙️ Business]
```

### Stage 1.6 — Schema 清理

- 删除 `features/ai/workflow/`（归档为 `agents/business.archive/`）
- 确认 `WorkflowRun` 表依赖关系后处理

## Coding Agent 状态设计

```typescript
interface CodingAgentState {
  goal: string;              // 当前目标
  messages: Message[];        // 对话历史
  workspace: string;          // cwd
  steps: number;             // 已执行步数
  filesChanged: string[];    // 修改过的文件
  toolCalls: ToolCall[];     // 工具调用记录
  status: "running" | "waiting" | "completed" | "failed";
  isStreaming: boolean;
}
```

## 与旧方案的区别

| 旧方案（废弃） | 新方案 |
|---|---|
| 单一"Work Mode" | 三层 Agent Profile |
| 所有工具混在一起 | 工具按 Profile 严格隔离 |
| 废弃 LangGraph | LangGraph 用于 Conversation + Business |
| 纯 Pi 风格 | Pi 用于 Coding，LangGraph 用于 Chat+Business |

## 改动摘要

| 阶段 | 新增 | 删除/归档 |
|------|------|----------|
| Stage 1.1 | coding/ tools + agent.ts | 重命名 |
| Stage 1.2 | runtime/* | 0 |
| Stage 1.3 | agents/conversation/* | features/ai/graph/ |
| Stage 1.4 | agents/business/* | features/ai/workflow/ |
| Stage 1.5 | ui/AgentProfileSwitcher.tsx | 0 |
| Stage 1.6 | 0 | 旧目录归档 |
