---
name: 模型选择器重构计划
overview: 重构 AI 模型选择器 UI：Tab 精简为 auto/chat/image/video，chat tab 增加工具模式下拉框，模型下拉框按 category 分组展示。前端 Task Router 提供 Hint，后端 detect-intent.ts 是最终权威判断。
todos:
  - id: mod-task-router
    content: "新增 Task Router: features/ai/routing/task-router.ts"
    status: pending
  - id: mod-task-router-test
    content: "新增 Task Router 单元测试（18 个用例）"
    status: pending
  - id: mod-modes
    content: "修改 modes.ts: 新增类型、精简 AI_MODE_OPTIONS"
    status: pending
  - id: mod-detect-intent
    content: "扩展 detect-intent.ts: video 模式 + 讨论词优先"
    status: pending
  - id: mod-model-routing
    content: "扩展 llm/model-routing.ts: 支持 capabilities 匹配"
    status: pending
  - id: mod-registry
    content: "增强 registry.ts: capabilities 分层获取"
    status: pending
  - id: mod-model-selector
    content: "重构 ModelSelector: 按 category 过滤 + tier 分组"
    status: pending
  - id: mod-chat-panel
    content: "修改 AiChatPanel: Tab UI 精简 + chat 工具下拉框"
    status: pending
isProject: false
---

## 重构模型下拉框和 Tab

### 架构原则

> **Tab 决定用户是否手动指定任务类型；Auto 模式由前端轻量 Task Router 提供 Hint；后端 detect-intent.ts 是最终权威判断；Backend Model Router 根据任务类型、模型 capabilities 和模型策略选择最终模型。**

**8 个核心原则**：
1. **Task Router 不写在 AiChatPanel**：抽取到独立模块
2. **前端 Task Router = 轻量 Hint，不参与最终决策**：只给请求提供预判，后端 detect-intent 是最终真相
3. **后端 detect-intent.ts = 最终权威 Task Router**：workflow、RAG、Web、image、video、用户行为查询
4. **三层判断逻辑**：明确讨论/查询 > 明确执行生成 > chat tool 判断
5. **明确执行生成 > 附带讨论词**：有生成动词+对象时，讨论词不干扰
6. **手动模式不需要 Router**：直接使用 UI State
7. **capabilities 权威来源是 ModelCatalogEntry**：inferFromModelId 只是 fallback
8. **selectedModel 和 aiMode 解绑**：`null = 用户未指定模型`，不绑定 auto

### 架构图

```
                         AiChatPanel
                               │
                        用户选择 Tab
                               │
                ┌──────────────┴──────────────┐
                │                             │
               Auto                          手动
                │                             │
                ▼                             ▼
         Frontend Task Router           用户明确选择
         （轻量 Hint，不做决策）         chat/image/video
                │                             │
                └──────────────┬──────────────┘
                               │
                          API Request
                               │
                               ▼
                Backend detect-intent.ts
                  （最终权威判断）
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
              chat          image          video
                │
         ┌──────┼──────┐
         ▼      ▼      ▼
        chat  search   web
                │
                ▼
        llm/model-routing.ts
        （最终模型选择）
                │
         modelName 有？
          ┌────┴────┐
         yes        no
          │          │
          ▼          ▼
      指定模型  capabilities 匹配
                      │
                tier/provider
                      │
                      ▼
                  最终模型
```

### 职责边界

| 组件 | 职责 | 决策级别 |
|------|------|---------|
| `features/ai/routing/task-router.ts` | 前端轻量 Hint，仅 Auto 模式使用 | **非权威** |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | 后端最终任务判断，包含 workflow | **权威** |
| `features/ai/llm/model-routing.ts` | 模型选择 | **权威** |

**关键约束**：
- 前端 Task Router 只提供 `taskHint`，后端可忽略
- 后端 detect-intent 是唯一最终决策者
- model-routing 不新建文件，扩展现有 `llm/model-routing.ts`

### 架构图

```
                         AiChat
                            │
                     用户选择 Tab
                            │
              ┌─────────────┴─────────────┐
              │                           │
             Auto                        手动
              │                           │
              ▼                           ▼
        Task Router                 直接使用 State
              │                           │
       ┌──────┼──────┐             category + tool
       ▼      ▼      ▼                     │
     chat   image   video                  │
       │      │       │                    │
       ▼      │       │                    │
 ChatToolMode │       │                    │
 chat/search/web       │                    │
       │      │       │                    │
       └──────┴───────┴────────────────────┘
                            │
                            ▼
                    Backend Model Router
                            │
                    modelName 存在？
                       /          \
                     yes           no
                      │             │
                      ▼             ▼
                  指定模型      capability 匹配
                                    │
                                    ▼
                              provider / tier
                                    │
                                    ▼
                               最终模型
```

### 1. 新建 Task Router 模块 (`features/ai/routing/task-router.ts`)

**定位**：前端轻量 Hint Router，仅用于 Auto 模式的 UX 预判，**不参与最终业务决策**。

**设计原则**：
- 只做快速的 Task Category 判断，不做深层意图理解
- **三层判断**：明确讨论/查询 > 明确执行生成 > chat tool 判断
- **明确执行生成 > 附带讨论词**：有生成动词+对象时，讨论词不干扰
- 宁可不触发，也不要误判普通聊天为生成任务
- 作为 MVP fallback 方案，后续可升级为 LLM 分类器

```typescript
export type ResolvedAiIntent = {
  category: "chat" | "image" | "video";
  toolMode?: "chat" | "search" | "web";
};

/**
 * Frontend Lightweight Task Router (Hint Router)
 *
 * 仅用于 Auto 模式的 UX 预判，输出作为 taskHint 传给后端。
 * 后端 detect-intent.ts 是最终权威判断，此函数结果可能被忽略。
 *
 * 三层判断逻辑：
 * 1. 明确执行生成？（动词 + 对象）→ 最高优先级
 * 2. 弱生成意图？（"怎么生成..."）→ chat
 * 3. 其他 → chat tool 判断
 */
export function resolveIntent(input: string): ResolvedAiIntent {
  // ── Step 1: 明确执行生成（有动词 + 有对象）────────────────────────────
  // 图片生成
  const imageVerbPattern = /(?:帮我|请|帮我)?(?:生成|画|创作|制作)(?:一张|一幅)?/i;
  const imageObjectPattern = /(?:图片?|图|画像|照片|封面|海报)/i;
  const hasImageVerb = imageVerbPattern.test(input);
  const hasImageObject = imageObjectPattern.test(input);
  const isImageGeneration = hasImageVerb && hasImageObject;

  if (isImageGeneration) {
    return { category: "image" };
  }

  // 视频生成
  const videoVerbPattern = /(?:帮我|请|帮我)?(?:生成|制作|创作)(?:一个?|段?)?/i;
  const videoObjectPattern = /(?:视频?|短片|动画|影片)/i;
  const hasVideoVerb = videoVerbPattern.test(input);
  const hasVideoObject = videoObjectPattern.test(input);
  const isVideoGeneration = hasVideoVerb && hasVideoObject;

  if (isVideoGeneration) {
    return { category: "video" };
  }

  // ── Step 2: 弱生成意图（"怎么生成..."、"分析..."、"介绍一下..."）→ chat ─
  const weakGenerationPatterns = /(?:怎么|如何|是什么|为什么|哪个好|有哪些|对比|分析|介绍|讲解|说明|原理|技术|方法|思路)/i;
  const hasWeakIntent = weakGenerationPatterns.test(input);

  if (hasWeakIntent) {
    if (/(?:知识库|文档|rga|RAG|详细内容|具体内容|需求文档|设计文档|技术文档)/i.test(input)) {
      return { category: "chat", toolMode: "search" };
    }
    if (/(?:天气|气温|联网|搜索|latest|实时|今日新闻|最近新闻)/i.test(input)) {
      return { category: "chat", toolMode: "web" };
    }
    return { category: "chat", toolMode: "chat" };
  }

  // ── Step 3: 其他 → chat tool 判断 ───────────────────────────────────
  if (/(?:知识库|文档|rga|RAG|详细内容|具体内容|需求文档|设计文档|技术文档)/i.test(input)) {
    return { category: "chat", toolMode: "search" };
  }
  if (/(?:天气|气温|联网|搜索|latest|实时|今日新闻|最近新闻)/i.test(input)) {
    return { category: "chat", toolMode: "web" };
  }
  return { category: "chat", toolMode: "chat" };
}

/**
 * 提取 taskHint 用于 API 请求
 */
export function getTaskHint(intent: ResolvedAiIntent): string | undefined {
  if (intent.category === "image") return "image";
  if (intent.category === "video") return "video";
  return undefined;
}
```

**测试用例（必须覆盖）**：

| 输入 | 期望 category | 边界类型 |
|------|-------------|---------|
| "帮我生成一张赛博朋克城市图片" | image | 明确生成 |
| "帮我画一张猫" | image | 明确生成 |
| "生成一张产品封面" | image | 明确生成 |
| "生成一张图，分析一下构图方案" | image | **明确生成 > 附带讨论词** |
| "请制作一个视频，介绍我们的产品" | video | **明确生成 > 附带讨论词** |
| "帮我制作一个产品宣传视频" | video | 明确生成 |
| "怎么生成一张产品图片" | chat | **方法询问 → chat** |
| "介绍一下图片生成技术" | chat | **讨论技术 → chat** |
| "分析一下这个视频" | chat | **讨论 → chat** |
| "视频生成模型哪个好" | chat | **讨论 → chat** |
| "帮我分析一下视频生成技术" | chat | 讨论技术 |
| "视频生成技术有哪些" | chat | 讨论技术 |
| "怎么生成 AI 视频" | chat | 方法询问 |
| "怎么制作产品宣传视频" | chat | 方法询问 |
| "帮我找一下知识库里关于 RAG 的文档" | chat (search) | 知识库 |
| "帮我查一下今天 OpenAI 最新消息" | chat (web) | 联网 |
| "帮我分析一下这个项目" | chat | 通用 |
| "你好" | chat | 通用 |

### 2. 类型定义 (`features/ai/types/modes.ts`)

```typescript
// chat 模式下的工具子模式
export type ChatToolMode = "chat" | "web" | "search";

// 用于 Tab + 模型过滤的顶级 category
export type AiTaskCategory = "auto" | "chat" | "image" | "video";
```

### 3. 精简 Tab 配置 (`features/ai/types/modes.ts`)

将 AI_MODE_OPTIONS 从 5 个精简为 4 个：

| 当前 Tab | 改为 Tab | 备注 |
|------|------|------|
| auto（自动） | auto（自动） | 保留，调用 Task Router |
| search（知识检索） | - | 折叠到 chat tab 下拉框 |
| chat（通用对话） | chat（通用对话） | 保留 |
| web（联网搜索） | - | 折叠到 chat tab 下拉框 |
| image（生图） | image（生图） | 保留 |
| - | video（视频生成） | 新增 Tab |

### 4. ModelSelector 行为

| category | 显示内容 |
|---------|---------|
| `auto` | "自动选择模型"（不列具体模型） |
| `chat` | chat 模型按 tier 分组（reasoning > strong > fast > standard） |
| `image` | image 模型按 provider 分组 |
| `video` | video 模型按 provider 分组 |

**selectedModel 语义**：`null = 用户未指定模型`，不绑定任何 Tab。

```typescript
const [selectedModel, setSelectedModel] = useState<string | null>(null);
```

所有 Tab 都可以设置为 null，由后端 Model Router 自动选择。

### 5. AiChatPanel handleSend 逻辑

**核心原则**：手动模式不需要 Router，直接使用 UI State。

```typescript
import { resolveIntent, getTaskHint } from "@/features/ai/routing/task-router";

const handleSend = async (message: string) => {
  // ── Intent Resolution ─────────────────────────────────────────────
  // Auto 模式：调用前端 Task Router 获取 Hint
  // 手动模式：直接使用 UI State
  const intent =
    aiMode === "auto"
      ? resolveIntent(message)
      : {
          category: aiMode,
          toolMode: aiMode === "chat" ? chatToolMode : undefined,
        };

  // ── TaskHint（仅 Auto 模式）────────────────────────────────────
  // 前端 Hint，后端可忽略（最终判断在 detect-intent.ts）
  const taskHint = aiMode === "auto" ? getTaskHint(intent) : undefined;

  // ── Model Selection ──────────────────────────────────────────────
  const modelName = selectedModel ?? undefined;

  // ── Mode Mapping ────────────────────────────────────────────────
  const mode = intent.category === "chat"
    ? intent.toolMode ?? "chat"
    : intent.category;

  // ── Request Body ───────────────────────────────────────────────
  const requestBody = {
    mode,
    ...(modelName && { modelName }),
    ...(taskHint && { taskHint }),
  };
};
```

### 6. 后端 detect-intent 增强 (`features/ai/agents/conversation/nodes/detect-intent.ts`)

**扩展现有 detectMode() 函数**，新增 video 模式判断和讨论词优先逻辑：

```typescript
export function detectMode(message: string): AgentMode {
  const trimmed = message.trim();

  // 1. 明确执行生成 → image/video（优先级最高）
  const hasImageIntent = /(?:帮我|请|帮我)?(?:生成|画|创作|制作)(?:一张|一幅)?.*(?:图片?|图|画像|照片|封面|海报)/i.test(trimmed);
  if (hasImageIntent) return "image";

  const hasVideoIntent = /(?:帮我|请|帮我)?(?:生成|制作|创作)(?:一个?|段?)?.*(?:视频?|短片|动画|影片)/i.test(trimmed);
  if (hasVideoIntent) return "video";

  // 2. 弱生成意图（"怎么生成..."、"分析..."、"介绍一下..."）→ chat/search/web
  // 这些不触发生成，走原有逻辑
  const weakGenerationPatterns = /(?:怎么|如何|是什么|为什么|哪个好|有哪些|对比|分析|介绍|讲解|说明|原理|技术|方法|思路)/i;
  const hasWeakIntent = weakGenerationPatterns.test(trimmed);
  if (hasWeakIntent) {
    // 走原有 detectMode 逻辑
    // ...
  }

  // 3. 原有逻辑...
}
```

### 7. 后端 Model Router 扩展 (`features/ai/llm/model-routing.ts`)

**扩展现有 selectModel() 函数**，支持 capabilities 匹配：

```typescript
export function selectModel(
  taskType: TaskType,
  options?: {
    manualOverride?: string;
    defaults?: Record<TaskType, string>;
    capabilities?: ModelCapability[];  // 新增
  }
): { providerId: string; modelName: string } {
  // 1. 手动覆盖优先
  if (options?.manualOverride) {
    return parseModelRef(options.manualOverride);
  }

  // 2. 根据 taskType/capabilities 匹配
  if (options?.capabilities && options.capabilities.length > 0) {
    return selectByCapabilities(options.capabilities);
  }

  // 3. 用户默认配置
  if (options?.defaults?.[taskType]) {
    return parseModelRef(options.defaults[taskType]);
  }

  // 4. 系统默认值...
}

function selectByCapabilities(capabilities: ModelCapability[]): { providerId: string; modelName: string } {
  // 从 ModelCatalog 中查找匹配 capabilities 的模型
  // 按 tier/provider/availability 排序
  // 返回最佳模型
}
```

### 8. AiModel 新增 capabilities 字段 (`features/ai/ui/model-select/types.ts`)

```typescript
import type { ModelCapability } from "@/features/ai/llm/providers/types";

export type AiModel = {
  // ... 现有字段
  capabilities: ModelCapability[]; // 来自 ModelCatalogEntry.capabilities，支持多值
};
```

在 `useModelCatalog.ts` 的 `transformModels()` 中透传 `entry.capabilities`。

### 6. 修改 AiChatPanel (`features/ai/ui/AiChatPanel.tsx`)

**状态变更**：
```typescript
const [aiMode, setAiMode] = useState<AiTaskCategory>("auto");
const [chatToolMode, setChatToolMode] = useState<ChatToolMode>("chat");
const [selectedModel, setSelectedModel] = useState<string | null>(null); // 用户未指定模型时为 null
```

**Tab UI 改动**：
- 精简为 4 个 Tab：自动、chat、image、video
- 选中 chat 时，Tab **右侧**显示工具模式下拉框（💬 通用对话 / 🔍 知识检索 / 🌐 联网搜索），默认 chat

**aiMode 切换时重置 chatToolMode**：
```typescript
const handleModeChange = (newMode: AiTaskCategory) => {
  setAiMode(newMode);
  if (newMode === "chat") {
    setChatToolMode("chat"); // 切换到 chat tab 时重置工具模式
  }
  // 注意：selectedModel 不需要重置，允许用户保持未指定状态
};
```

### 7. API 层：capabilities 来源分层 (`features/ai/llm/providers/registry.ts`)

**核心原则**：capabilities 的权威来源是 `ModelCatalogEntry.capabilities`，`inferCapabilities` 只是 fallback。

```typescript
// 优先级：ModelCatalogEntry.capabilities > inferFromModelId > default

/**
 * 获取模型 capabilities
 * 1. ModelCatalogEntry.capabilities（权威来源）
 * 2. inferFromModelId（fallback，仅在 catalog 无数据时使用）
 */
export function getModelCapabilities(
  entry: ModelCatalogEntry | null,
  modelId: string
): ModelCapability[] {
  // 1. 优先使用 catalog 中的 capabilities
  if (entry?.capabilities && entry.capabilities.length > 0) {
    return entry.capabilities;
  }

  // 2. Fallback：从 modelId 推断
  return inferFromModelId(modelId);
}

function inferFromModelId(modelId: string): ModelCapability[] {
  const lower = modelId.toLowerCase();
  const caps: ModelCapability[] = [];

  // 注意：这是 fallback，不要依赖它作为唯一来源
  if (lower.includes("video") || lower.includes("sora") || lower.includes("kling") || lower.includes("wan"))
    caps.push("video");
  if (lower.includes("image") || lower.includes("dall-e") || lower.includes("flux") || lower.includes("imagen"))
    caps.push("image");
  if (lower.includes("vision") || lower.includes("gpt-4o") || lower.includes("claude-3-opus"))
    caps.push("vision");
  // ... 保持原有 reasoning/strong/fast/standard 检测

  return caps.length > 0 ? caps : ["standard"];
}
```

### 8. 后端 Model Router（Auto 模式的必要依赖）

后端必须实现 Model Router，Auto 模式才能真正工作：

```
Request: { mode: "image" }
         ↓
Backend Model Router
         ↓
capabilities.includes("image")
         ↓
按 provider / tier 排序
         ↓
返回最佳模型
```

**后端请求结构**：
```typescript
interface AiRequest {
  mode: "chat" | "search" | "web" | "image" | "video";
  modelName?: string;  // undefined = 后端自动选择
  message: string;
  // ...
}
```

### 12. 文件修改清单

```
features/ai/
├── routing/
│   ├── task-router.ts          # 新增：前端轻量 Hint Router
│   └── task-router.test.ts     # 新增：单元测试
├── llm/
│   ├── model-routing.ts        # 扩展：支持 capabilities 匹配
│   └── model-selector.tsx      # UI 重构
├── agents/conversation/
│   └── nodes/
│       └── detect-intent.ts    # 扩展：video 模式 + 讨论词优先
└── ui/
    └── AiChatPanel.tsx
```

| 文件 | 改动 |
|------|------|
| `features/ai/routing/task-router.ts` | **新增**：前端轻量 Hint Router（三层判断） |
| `features/ai/routing/task-router.test.ts` | **新增**：单元测试（18 个用例含边界） |
| `features/ai/types/modes.ts` | 新增 `ChatToolMode`、`AiTaskCategory`；精简 `AI_MODE_OPTIONS` |
| `features/ai/types/index.ts` | 导出新类型 |
| `features/ai/llm/model-routing.ts` | **扩展**：支持 capabilities 匹配 |
| `features/ai/llm/providers/registry.ts` | `getModelCapabilities` 分层获取 |
| `features/ai/ui/model-select/types.ts` | `AiModel` 新增 `capabilities` |
| `features/ai/ui/model-select/useModelCatalog.ts` | `transformModels` 透传 capabilities |
| `features/ai/ui/model-select/ModelList.tsx` | 按 category 过滤 |
| `features/ai/llm/model-selector.tsx` | 重构：按 category 过滤 |
| `features/ai/ui/AiChatPanel.tsx` | Tab UI + chat 工具下拉框 + Task Router |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | **扩展**：video 模式 + 讨论词优先 |

### 10. Task Router 单元测试（必须实现）

在 `features/ai/routing/task-router.test.ts` 中实现 18 个测试用例：

```typescript
import { resolveIntent } from "./task-router";

describe("resolveIntent", () => {
  describe("明确生成", () => {
    test("帮我生成一张赛博朋克城市图片 → image", () => {
      expect(resolveIntent("帮我生成一张赛博朋克城市图片")).toEqual({ category: "image" });
    });

    test("帮我画一张猫 → image", () => {
      expect(resolveIntent("帮我画一张猫")).toEqual({ category: "image" });
    });

    test("生成一张产品封面 → image", () => {
      expect(resolveIntent("生成一张产品封面")).toEqual({ category: "image" });
    });

    test("请制作一个视频，介绍我们的产品 → video", () => {
      expect(resolveIntent("请制作一个视频，介绍我们的产品")).toEqual({ category: "video" });
    });

    test("帮我制作一个产品宣传视频 → video", () => {
      expect(resolveIntent("帮我制作一个产品宣传视频")).toEqual({ category: "video" });
    });
  });

  describe("明确生成 > 附带讨论词", () => {
    test("生成一张图，分析一下构图方案 → image", () => {
      expect(resolveIntent("生成一张图，分析一下构图方案")).toEqual({ category: "image" });
    });

    test("帮我画一张猫，介绍一下设计思路 → image", () => {
      expect(resolveIntent("帮我画一张猫，介绍一下设计思路")).toEqual({ category: "image" });
    });
  });

  describe("讨论/查询类 → chat", () => {
    test("怎么生成一张产品图片 → chat", () => {
      expect(resolveIntent("怎么生成一张产品图片")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("介绍一下图片生成技术 → chat", () => {
      expect(resolveIntent("介绍一下图片生成技术")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("分析一下这个视频 → chat", () => {
      expect(resolveIntent("分析一下这个视频")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("视频生成模型哪个好 → chat", () => {
      expect(resolveIntent("视频生成模型哪个好")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("帮我分析一下视频生成技术 → chat", () => {
      expect(resolveIntent("帮我分析一下视频生成技术")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("视频生成技术有哪些 → chat", () => {
      expect(resolveIntent("视频生成技术有哪些")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("怎么生成 AI 视频 → chat", () => {
      expect(resolveIntent("怎么生成 AI 视频")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("怎么制作产品宣传视频 → chat", () => {
      expect(resolveIntent("怎么制作产品宣传视频")).toEqual({ category: "chat", toolMode: "chat" });
    });
  });

  describe("知识库检索", () => {
    test("帮我找一下知识库里关于 RAG 的文档 → search", () => {
      expect(resolveIntent("帮我找一下知识库里关于 RAG 的文档")).toEqual({ category: "chat", toolMode: "search" });
    });
  });

  describe("联网搜索", () => {
    test("帮我查一下今天 OpenAI 最新消息 → web", () => {
      expect(resolveIntent("帮我查一下今天 OpenAI 最新消息")).toEqual({ category: "chat", toolMode: "web" });
    });
  });

  describe("通用对话", () => {
    test("帮我分析一下这个项目 → chat", () => {
      expect(resolveIntent("帮我分析一下这个项目")).toEqual({ category: "chat", toolMode: "chat" });
    });

    test("你好 → chat", () => {
      expect(resolveIntent("你好")).toEqual({ category: "chat", toolMode: "chat" });
    });
  });
});
```

### 11. 兼容性注意

- `AI_MODE_OPTIONS` 数组长度从 5 → 4
- `chatToolMode` 默认 `"chat"`，切换到 chat tab 时重置
- `selectedModel = null` 表示用户未指定模型，所有 Tab 都适用
- Task Router 定位为 MVP fallback，后续可升级为 LLM 分类器
- 后端 Model Router 是 Auto 模式的必要依赖，必须实现
- capabilities 权威来源是 ModelCatalogEntry，inferFromModelId 只是 fallback
- model-router 放在 `features/ai/routing/` 而非 `features/ai/llm/`
