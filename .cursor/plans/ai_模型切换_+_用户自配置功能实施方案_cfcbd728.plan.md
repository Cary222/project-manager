---
name: AI 模型切换 + 用户自配置功能实施方案
overview: 在 app/ai/page.tsx 左上角添加模型选择下拉框，在 settings/page.tsx 添加 AI 模型配置区块。两功能共用同一个模型配置层（服务端存 API Key，前端只存 providerId）。第一版支持 Agnes（现有）+ DeepSeek（用户提供），长期可扩展任意 OpenAI 兼容 Provider。
todos:
  - id: stage-1-1
    content: "Stage 1.1: 建立 Provider Registry + types + config-store（服务端配置层）"
    status: pending
  - id: stage-1-2
    content: "Stage 1.2: SettingsCenter 新增 AI 模型配置区块（ROOT 权限）"
    status: pending
  - id: stage-1-3
    content: "Stage 1.3: App/api/ai/models/route.ts 模型 CRUD API"
    status: pending
  - id: stage-1-4
    content: "Stage 1.4: AiChatPanel 左上角新增 ModelSelector 下拉组件"
    status: pending
  - id: stage-1-5
    content: "Stage 1.5: generate-response.ts 支持动态 providerId"
    status: pending
  - id: stage-1-6
    content: TypeScript 编译检查 + 端到端 smoke test
    status: pending
isProject: false
---

# Plan: AI 模型切换 + 用户自配置功能

## 需求摘要

| 需求 | 位置 | 说明 |
|------|------|------|
| 左上角模型选择下拉框 | `app/ai/page.tsx` | 切换当前会话使用的模型 |
| 设置页 AI 模型配置 | `settings/page.tsx` | ROOT 管理所有模型（API Key / Base URL / 模型名） |

## 架构决策

### 为什么不在 agnes-provider.ts 里硬编码多模型

现有 `agnes-provider.ts` 直接用 `createOpenAI()` 创建单例，当前端换模型需要改代码。新的设计：

```
前端选择 providerId
    ↓
POST /api/ai/conversations/{id}/messages 带上 providerId
    ↓
后端根据 providerId 查用户配置的 API Key，从 provider registry 创建模型
    ↓
调用 generateText({ model })
```

### 关键约束

- **API Key 绝不在前端明文传输**：服务端从 DB/Env 读取，前端只传 `providerId`
- **复用现有 `ai` SDK**：`createOpenAI()` / `createDeepSeek()` 均来自 `@ai-sdk/openai` / `@ai-sdk/deepseek`，兼容现有 `generateText()` 调用方式
- **向下兼容**：未配置时默认 Agnes

## 目录结构

```
features/ai/
├── llm/
│   ├── providers/
│   │   ├── registry.ts          # 模型注册表（新增）
│   │   ├── deepseek.ts          # DeepSeek Provider（新增）
│   │   ├── agnes.ts             # Agnes Provider（从 agnes-provider.ts 拆分）
│   │   └── types.ts             # Provider 类型定义（新增）
│   ├── config-store.ts          # 服务端配置读写（新增）
│   └── model-selector.tsx       # 模型选择下拉组件（新增）
│
├── graph/nodes/generate-response.ts   # 改动：支持动态 providerId
│
app/
├── api/ai/
│   ├── models/route.ts          # GET list / POST create / DELETE（新增）
│   └── conversations/[id]/
│       └── messages/route.ts    # 改动：支持 providerId 参数
│
settings/page.tsx                # 改动：新增 AI 模型配置区块
```

## 实施计划

### Stage 1.1：模型配置层（服务端）

**目标**：建立 Provider Registry + 配置 CRUD API。

#### 1. 新建 `features/ai/llm/providers/types.ts`

```typescript
export interface LLMProvider {
  id: string;                 // "agnes" | "deepseek" | "openai"
  name: string;               // 显示名："Agnes" | "DeepSeek"
  description?: string;
  baseURL?: string;           // OpenAI 兼容端点
  defaultModel: string;        // 默认模型名
  apiKey?: string;            // 仅服务端使用，从不传给前端
  isDefault?: boolean;         // 默认选中
}

export interface UserModelConfig {
  id: string;
  userId: string;
  providerId: string;
  modelName: string;          // 可覆盖默认模型
  apiKey?: string;            // 用户自己的 Key（服务端加密存储）
  baseURL?: string;           // 自定义端点（如代理）
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

#### 2. 新建 `features/ai/llm/providers/registry.ts`

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";

const SYSTEM_PROVIDERS: LLMProvider[] = [
  {
    id: "agnes",
    name: "Agnes",
    description: "恒星研内部 AI 助手（默认）",
    baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
    defaultModel: "agnes-2.5-flash",
  },
];

export function getProvider(id: string): LLMProvider | undefined {
  return SYSTEM_PROVIDERS.find(p => p.id === id);
}

export function createModel(providerId: string, config?: { apiKey?: string; model?: string; baseURL?: string }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const apiKey = config?.apiKey ?? provider.apiKey ?? "";
  const model = config?.model ?? provider.defaultModel;
  const baseURL = config?.baseURL ?? provider.baseURL;

  if (providerId === "deepseek") {
    return createDeepSeek({ apiKey, baseURL })(model);
  }
  // OpenAI 兼容（agnes / openai / 自定义）
  return createOpenAI({ apiKey, baseURL })(model);
}
```

#### 3. 新建 `app/api/ai/models/route.ts`

支持 ROOT 用户管理全局模型配置（API Key 存服务端 Env，不存 DB）：

```typescript
// GET: 列出所有可用模型（不含 API Key）
// POST: 更新模型配置（ROOT）
// DELETE: 重置模型配置
```

**安全原则**：返回给前端的模型列表永远不包含 `apiKey` 明文，只返回 `apiKeyMasked`（如 `sk-****1234`）。

---

### Stage 1.2：Settings 页 AI 模型配置区块

**目标**：ROOT 用户在设置页配置各 Provider 的 API Key。

#### UI 设计（参考 shadcn/settings-api-keys block）

```
┌─ AI 模型配置 ───────────────────────────────────────┐
│                                                      │
│  当前默认模型：Agnes (agnes-2.5-flash)              │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │ Agnes                                    [编辑] │  │
│  │ 端点：https://apihub.agnes-ai.com/v1         │  │
│  │ 模型：agnes-2.5-flash (默认)                 │  │
│  │ 状态：已配置 ✓                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │ DeepSeek                                  [配置] │  │
│  │ 端点：https://api.deepseek.com/v1            │  │
│  │ 状态：未配置（点击配置）                     │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌─ 添加自定义模型 ──────────────────────────────┐  │
│  │ Provider: [选择 ▼]  模型: [输入框]         │  │
│  │ Base URL: [输入框]    API Key: [输入框]     │  │
│  │                                    [添加]   │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### 改动 `features/settings/SettingsCenter.tsx`

在 `SectionCard` 中新增一个 AI 配置区块，使用 ROOT 权限控制可见性。

---

### Stage 1.3：Chat 界面模型选择下拉框

**目标**：左上角"小星 · AI 助手"旁边加模型切换下拉。

#### 改动 `features/ai/ui/AiChatPanel.tsx`

现有左上角 Header 区域（line 936-998）改造：

```tsx
// 现有 AiMode 切换的 segmented control 旁边，加一个模型选择下拉
<div className="flex items-center gap-1">
  {/* 现有模式切换 */}
  <div className="flex items-center rounded-lg bg-ink-100 p-0.5">
    {AI_MODE_OPTIONS.map(...)}
  </div>
  
  {/* 新增：模型选择 */}
  <ModelSelector
    currentModel={selectedModel}
    onChange={(modelId) => setSelectedModel(modelId)}
  />
  
  {/* 清空按钮 */}
  <button>...</button>
</div>
```

#### 新建 `features/ai/llm/model-selector.tsx`

```tsx
"use client";

import { useState, useEffect } from "react";

interface ModelOption {
  id: string;
  name: string;
  defaultModel: string;
  isConfigured: boolean;
}

export function ModelSelector({ currentModel, onChange }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/ai/models").then(r => r.json()).then(d => setModels(d.data));
  }, []);

  const current = models.find(m => m.id === currentModel);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50">
          <IconRobot className="h-3.5 w-3.5" />
          {current?.name ?? "选择模型"}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        {models.map(model => (
          <button
            key={model.id}
            onClick={() => { onChange(model.id); setOpen(false); }}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
              model.id === currentModel ? "bg-brand-50 text-brand-700" : "hover:bg-ink-100"
            }`}
          >
            <span>{model.name}</span>
            {model.id === currentModel && <IconCheck className="h-4 w-4" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

**需要新增依赖**：`@radix-ui/react-popover`（项目中已有 Radix 依赖，可直接用）。

---

### Stage 1.4：后端 API 支持 providerId

#### 改动 `app/api/ai/conversations/[id]/messages/route.ts`

```typescript
// 读取请求中的 providerId（默认 "agnes"）
const providerId = body.providerId ?? "agnes";

// 调用时传入
const model = createModel(providerId, { apiKey: configStore.getApiKey(providerId) });

const result = await generateText({
  model,  // ← 替换原来的固定 agnes 模型
  system: ...,
  messages: ...,
});
```

#### 改动 `features/ai/graph/nodes/generate-response.ts`

将 `withAgnetModelFallback()` 替换为动态 provider 调用：

```typescript
// 不再 hardcode agnes，改从 request context 读 providerId
export async function generateResponseNode(
  state: AgentState,
  options?: { providerId?: string }
) {
  const providerId = options?.providerId ?? "agnes";
  const model = createModel(providerId);
  
  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
  });
}
```

**注意**：`generate-response.ts` 需要从 LangGraph graph 调用处传入 `providerId`，这意味着 `agentGraph.invoke()` 的调用处也需要改动。

---

### Stage 1.5：用户级模型偏好

**可选增强**：普通用户也可以保存自己的默认模型偏好。

- 新建 `user_ai_preferences` 表（userId, defaultModelId）
- Settings 页"个人资料"区块下方加"AI 模型偏好"
- 前端 `AiChatPanel` 初始加载时从 `/api/ai/me/preferences` 获取默认模型

---

## 与现有 Workflow Agent 方案的关系

**两个需求独立，可并行实施**：

| 需求 | 改动范围 | 优先级 |
|------|---------|--------|
| AI 模型切换 + Settings 配置 | `features/ai/llm/` + `features/settings/` + API | 高（用户体验直接） |
| Workflow Agent（工作模式） | `features/ai/workflow/` 新目录 | 中（长期功能） |

## 参考实现汇总

| 来源 | 借鉴点 |
|------|--------|
| shadcn/ui model-selector | cmdk 命令面板 + Provider 分组 UI |
| shadcn/settings-api-keys block | Key 掩码显示 + 验证反馈 |
| `@nocoo/next-ai` | ProviderRegistry 工厂模式 |
| Vercel AI SDK docs | createDeepSeek / createOpenAI 统一接口 |

## 改动摘要

| 文件 | 操作 | 说明 |
|------|------|------|
| `features/ai/llm/providers/types.ts` | 新增 | Provider 类型定义 |
| `features/ai/llm/providers/registry.ts` | 新增 | Provider 注册 + 模型工厂 |
| `features/ai/llm/providers/agnes.ts` | 新增 | Agnes Provider（从 agnes-provider.ts 拆分） |
| `features/ai/llm/model-selector.tsx` | 新增 | 模型选择下拉组件 |
| `features/ai/llm/config-store.ts` | 新增 | 服务端配置读写 |
| `features/ai/llm/agnes-provider.ts` | 删除 | 合并到 providers/agnes.ts |
| `app/api/ai/models/route.ts` | 新增 | 模型 CRUD API |
| `features/ai/graph/nodes/generate-response.ts` | 修改 | 支持动态 providerId |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | 加 ModelSelector 组件 |
| `features/settings/SettingsCenter.tsx` | 修改 | 加 AI 模型配置区块 |

**新增依赖**：`@radix-ui/react-popover`（如未安装）

---

## 暂未决定的细节

1. **API Key 存储**：存 `.env`（系统级 Agnes）、存 DB（用户自定义 DeepSeek）？建议先简单处理：系统级放 Env，用户级放 DB 加密
2. **DeepSeek API Key**：是否需要在 Settings 页存到 DB？还是先放 `.env.local`？
3. **多模型并发**：用户选了 DeepSeek，但 Agnes 的 fallback 还有没有保留？（建议第一版只保留 Agnes fallback）

---

**下一步**：Stage 1.1 从服务端模型配置层开始，确认方案后我会按序推进实施。