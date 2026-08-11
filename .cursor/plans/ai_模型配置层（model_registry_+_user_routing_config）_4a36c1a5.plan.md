---
name: AI 模型配置层（Model Registry + User Routing Config）
overview: 在 features/ai/ 下建立 Model Registry 层：用户倒入自定义模型 + API Key，系统按任务类型智能路由 + 用户可选手动切换 + 用户可配置默认路由规则。与 LangGraph 架构对齐，在 graph 层加 model-select 节点。不做过度设计，第一版聚焦：Model Registry CRUD + Admin 配置默认模型 + Chat 界面手动切换 + 简单任务复杂度路由。
todos:
  - id: s1
    content: "Stage 1: Model Registry 服务端（providers/ + model-catalog + config-store）"
    status: pending
  - id: s2
    content: "Stage 2: SettingsCenter AI 模型配置区块（ROOT 配置默认模型，用户倒入自定义模型）"
    status: pending
  - id: s3
    content: "Stage 3: Chat 界面手动模型切换 + localStorage 记忆偏好"
    status: pending
  - id: s4
    content: "Stage 4: LangGraph graph 加 model-select 节点（按任务类型路由）"
    status: pending
  - id: s5
    content: "Stage 5: API 支持 modelName 参数 + generate-response 动态模型"
    status: pending
  - id: s6
    content: TypeScript 编译 + smoke test
    status: pending
isProject: false
---

# Plan: AI 模型配置层（Model Registry + User Routing Config）

## 需求澄清（用户确认版）

```
用户倒入自己的模型 + API Key（Settings 页）
    ↓
用户可选：手动切换模型 / 配置默认路由规则
    ↓
系统按任务类型智能路由（用户可覆盖）
```

**三层架构**：
1. **Model Registry**：管理员 + 用户可添加自定义模型
2. **User Routing Config**：用户配置默认路由规则
3. **Manual Override**：Chat 界面手动切换（覆盖路由）

**不做**：
- ❌ 自动模型评估 / AB Test / 动态成本调度
- ❌ 用户每次都选模型（只是可选项，不是默认）
- ❌ State 里存 `model: "xxx"`，改存 `modelContext: { taskType, capability }`

---

## 与 LangGraph 架构对齐

```
START
  ↓
detectIntent（检测意图 + 判断 taskType）
  ↓
modelSelect（新增：根据 taskType + 用户偏好路由到合适模型）
  ↓
  ├─ searchKnowledge → searchStructured
  ├─ webSearch
  └─ generateResponse（用 modelSelect 选定的模型）
  ↓
END
```

**关键点**：`modelSelect` 节点读取 `taskType` + `userRoutingConfig`，决定用哪个模型，注入到 State context。

---

## 目录结构

```
features/ai/
├── llm/
│   ├── providers/
│   │   ├── types.ts           # LLMProvider / ModelCatalogEntry / RoutingConfig
│   │   ├── registry.ts        # Provider 注册表 + 工厂函数
│   │   ├── system-providers.ts  # 内置：Agnes（来自现有 agnes-provider.ts）
│   │   └── user-providers.ts  # 用户自定义模型（存 DB 或 .env.local）
│   ├── model-catalog.ts       # 稳定模型别名（Stage 6 对齐）
│   ├── model-routing.ts       # 路由决策：根据 taskType + 规则选模型
│   └── model-selector.tsx    # 前端手动切换下拉
│
├── graph/
│   ├── state.ts               # 改动：加 modelContext 字段
│   ├── nodes/
│   │   ├── model-select.ts    # 新增：根据 taskType 路由模型
│   │   └── ...（现有节点不变）
│   └── edges/
│       └── routing.ts         # 改动：modelSelect → 各工具节点
│
app/api/ai/
└── models/route.ts           # GET 可用模型 / POST 添加模型
```

---

## 实施阶段

### Stage 1：Model Registry 服务端

#### 1. `features/ai/llm/providers/types.ts`

```typescript
/** 任务类型：用于模型路由决策 */
export type TaskType = "chat" | "search" | "rag" | "complex" | "quick";

/** 模型能力标签 */
export type ModelCapability = "fast" | "standard" | "strong" | "vision" | "reasoning";

export interface LLMProvider {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "deepseek" | "custom";
  baseURL?: string;
  apiKeyEnv?: string;   // 从 env 读 Key 的变量名
  models: ModelCatalogEntry[];
}

export interface ModelCatalogEntry {
  id: string;
  modelName: string;      // 实际调用名
  displayName: string;   // 用户看到的名称
  capabilities: ModelCapability[];
  maxTokens?: number;
  enabled: boolean;
}

export interface UserRoutingConfig {
  userId?: string;       // 空 = 全局默认
  defaults: Record<TaskType, string>;  // taskType → modelName
  manualOverride?: string; // 用户手动选的模型（优先于 defaults）
}
```

#### 2. `features/ai/llm/providers/system-providers.ts`

从现有 `agnes-provider.ts` 拆分：

```typescript
// 内置 Provider（从 env 读配置）
export const SYSTEM_PROVIDERS: LLMProvider[] = [
  {
    id: "agnes",
    name: "Agnes",
    provider: "openai",
    baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: [
      { id: "agnes-2.5-flash", modelName: "agnes-2.5-flash", displayName: "Agnes 2.5 Flash", capabilities: ["fast"], enabled: true },
      { id: "agnes-2.0-flash", modelName: "agnes-2.0-flash", displayName: "Agnes 2.0 Flash", capabilities: ["fast"], enabled: true },
    ],
  },
];
```

#### 3. `features/ai/llm/providers/user-providers.ts`

用户自定义模型（第一版：存 `.env.local` + 内存）：

```typescript
// 用户在 Settings 页填入 .env.local 的 DEEPSEEK_API_KEY
export const USER_PROVIDERS: LLMProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", modelName: "deepseek-chat", displayName: "DeepSeek Chat", capabilities: ["standard"], enabled: Boolean(process.env.DEEPSEEK_API_KEY) },
      { id: "deepseek-coder", modelName: "deepseek-coder", displayName: "DeepSeek Coder", capabilities: ["standard"], enabled: Boolean(process.env.DEEPSEEK_API_KEY) },
    ],
  },
];
```

后续接 DB 或中转平台 Gateway。

#### 4. `features/ai/llm/providers/registry.ts`

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { SYSTEM_PROVIDERS } from "./system-providers";
import { USER_PROVIDERS } from "./user-providers";
import type { LLMProvider, ModelCatalogEntry } from "./types";

export const ALL_PROVIDERS = [...SYSTEM_PROVIDERS, ...USER_PROVIDERS];

export function getProvider(id: string): LLMProvider | undefined {
  return ALL_PROVIDERS.find(p => p.id === id);
}

export function getEnabledModels(): ModelCatalogEntry[] {
  return ALL_PROVIDERS.flatMap(p => p.models.filter(m => m.enabled));
}

export function createModel(providerId: string, modelName: string) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const apiKey = provider.apiKeyEnv
    ? process.env[provider.apiKeyEnv] ?? ""
    : "";

  const baseURL = provider.baseURL ?? "https://api.openai.com/v1";

  switch (provider.provider) {
    case "deepseek":
      return createDeepSeek({ apiKey, baseURL })(modelName);
    case "openai":
    default:
      return createOpenAI({ apiKey, baseURL })(modelName);
  }
}
```

---

### Stage 2：SettingsCenter AI 模型配置区块

#### 改动 `features/settings/SettingsCenter.tsx`

在 ROOT 可见区块新增 AI 配置：

```
┌─ AI 模型配置 ─────────────────────────────────────────┐
│                                                        │
│  默认路由策略（管理员设置）                            │
│  ├─ 快速对话（chat/quick）→ Agnes 2.5 Flash        │
│  ├─ 知识检索（search/rag）→ Agnes 2.5 Flash        │
│  └─ 复杂分析（complex）→ DeepSeek Chat              │
│                                                        │
│  用户自定义模型                                      │
│  ├─ DeepSeek [配置] [启用]                          │
│  │   状态：已配置 ✓                                │
│  └─ + 添加自定义模型                               │
│       Provider: [OpenAI ▼]                          │
│       模型名称: [deepseek-chat]                     │
│       API Key: [********]                          │
│       Base URL: [可选]                             │
└──────────────────────────────────────────────────────┘
```

**用户自定义模型存储策略（第一版）**：
- API Key 暂时存 `.env.local`（用户手动配置到服务器）
- 后续接中转平台 Stage 2 `AiAccessKey` 表

---

### Stage 3：Chat 界面手动切换 + 路由状态

#### 5. 改动 `features/ai/llm/model-selector.tsx`

```tsx
"use client";
// 轻量下拉：只显示已启用的模型
// 不做复杂的 Command Palette（第一版够用）
```

#### 6. 改动 `features/ai/ui/AiChatPanel.tsx`

在 Header 加模型切换下拉，选中后：
- 更新 `selectedModel` state
- 写入 `localStorage["preferredModel"]`
- 请求带上 `modelName` 参数

```tsx
const [selectedModel, setSelectedModel] = useState(() =>
  localStorage.getItem("preferredModel") ?? "agnes-2.5-flash"
);
```

---

### Stage 4：LangGraph model-select 节点

#### 7. `features/ai/llm/model-routing.ts`

```typescript
import type { TaskType } from "./types";

/**
 * 根据任务类型 + 用户配置，决定使用哪个模型。
 * 优先级：manualOverride > 用户路由配置 > 系统默认值
 */
export function selectModel(
  taskType: TaskType,
  userConfig?: { manualOverride?: string; defaults?: Record<TaskType, string> }
): { providerId: string; modelName: string } {
  // 1. 手动覆盖优先
  if (userConfig?.manualOverride) {
    return parseModelRef(userConfig.manualOverride);
  }

  // 2. 用户路由配置
  if (userConfig?.defaults?.[taskType]) {
    return parseModelRef(userConfig.defaults[taskType]);
  }

  // 3. 系统默认值
  const defaults: Record<TaskType, string> = {
    quick: "agnes:agnes-2.5-flash",
    chat: "agnes:agnes-2.5-flash",
    search: "agnes:agnes-2.5-flash",
    rag: "agnes:agnes-2.5-flash",
    complex: "deepseek:deepseek-chat",
  };

  return parseModelRef(defaults[taskType] ?? defaults.chat);
}

function parseModelRef(ref: string): { providerId: string; modelName: string } {
  const [providerId, modelName] = ref.split(":");
  return { providerId, modelName };
}
```

#### 8. `features/ai/graph/nodes/model-select.ts`（新增）

```typescript
import type { AgentState } from "../agent";
import { selectModel } from "@/features/ai/llm/model-routing";
import type { TaskType } from "@/features/ai/llm/providers/types";

export async function modelSelectNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  // 从 detectIntent 已经解析出 taskType
  const taskType = (state.queryType as TaskType) ?? "chat";

  // 读取用户配置（从请求上下文传入，或从 DB 读取）
  const userConfig = (state as any).modelContext?.userConfig;

  const { providerId, modelName } = selectModel(taskType, userConfig);

  return {
    modelContext: {
      taskType,
      providerId,
      modelName,
      // 不存具体模型名在 State，存 context，让 generate-response 动态创建
    },
  };
}
```

#### 9. 改动 `features/ai/graph/state.ts`

在 `AgentStateAnnotation` 加：

```typescript
modelContext: Annotation<{
  taskType: TaskType;
  providerId: string;
  modelName: string;
  userConfig?: UserRoutingConfig;
} | null>({
  value: (current, update) => update === undefined ? current : update,
  default: () => null,
}),
```

#### 10. 改动 `features/ai/graph/agent.ts`

在 `detectIntent` 后面加 `modelSelect` 节点：

```typescript
.addNode("modelSelect", modelSelectNode)
.addEdge("detectIntent", "modelSelect")
// modelSelect 后面的边不变，继续走各工具节点
```

---

### Stage 5：API 支持 modelName 参数

#### 11. 改动 `app/api/ai/conversations/[id]/messages/route.ts`

```typescript
// 从请求体读 modelName（前端手动切换时传入）
const modelName = body.modelName;
// 从请求体读 manualOverride（覆盖路由）
const manualOverride = body.manualOverride;

// 传给 graph
const result = await agentGraph.invoke(
  { messages, mode, ... },
  {
    configurable: {
      modelName,
      manualOverride,
    },
  }
);
```

#### 12. 改动 `features/ai/graph/nodes/generate-response.ts`

```typescript
import { createModel } from "@/features/ai/llm/providers/registry";
import { selectModel } from "@/features/ai/llm/model-routing";

export async function generateResponseNode(state: AgentState) {
  const taskType = state.modelContext?.taskType ?? "chat";
  const manualOverride = (state as any).configurable?.manualOverride;
  const userConfig = { manualOverride };

  const { providerId, modelName } = selectModel(taskType, userConfig);
  const model = createModel(providerId, modelName);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
  });

  return { response: result.text };
}
```

---

## 与现有 Workflow Agent 方案的关系

两个需求独立，**可以并行实施**：

| 需求 | 改动范围 | 优先级 |
|------|---------|--------|
| AI 模型配置层 | `features/ai/llm/` + `features/settings/` + LangGraph graph 改动 | ⭐⭐⭐⭐ |
| Workflow Agent（工作模式） | `features/ai/workflow/` 新目录 | ⭐⭐⭐⭐（长期） |

---

## 暂未决定

1. **用户自定义模型 API Key 存哪？**
   - 第一版：`.env.local`（用户手动配）
   - 后续：中转平台 Stage 2 `AiAccessKey` 表

2. **用户路由配置存哪？**
   - 第一版：`localStorage`（简单够用）
   - 后续：中转平台 Stage 2 DB 表

3. **TaskType 怎么从 detectIntent 解析？**
   - `chat`/`quick`：普通对话，无关键词
   - `search`/`rag`：含搜索关键词
   - `complex`：含"分析/为什么/结合"等复杂推理词

---

## 改动摘要

| 文件 | 操作 | 说明 |
|------|------|------|
| `features/ai/llm/providers/types.ts` | 新增 | 类型定义 |
| `features/ai/llm/providers/system-providers.ts` | 新增 | 内置 Provider（从现有拆分） |
| `features/ai/llm/providers/user-providers.ts` | 新增 | 用户自定义 Provider |
| `features/ai/llm/providers/registry.ts` | 新增 | 工厂函数 |
| `features/ai/llm/model-routing.ts` | 新增 | 路由决策逻辑 |
| `features/ai/llm/model-selector.tsx` | 新增 | 前端切换下拉 |
| `features/ai/graph/state.ts` | 修改 | 加 modelContext 字段 |
| `features/ai/graph/nodes/model-select.ts` | 新增 | 路由节点 |
| `features/ai/graph/agent.ts` | 修改 | 加 modelSelect 节点 |
| `features/ai/graph/nodes/generate-response.ts` | 修改 | 动态模型 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | 支持 modelName |
| `features/settings/SettingsCenter.tsx` | 修改 | 加 AI 配置区块 |