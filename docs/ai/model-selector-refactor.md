# AI 模型选择器重构 — 开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + TypeScript）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"AI 模型选择器重构"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **模型来源单一**：只能使用硬编码的 Agnes 模型，无法动态发现用户配置的 provider
- **选择器 UI 简陋**：只有下拉列表，无法按类型/层级筛选
- **API Key 管理分散**：没有统一的 provider 配置界面
- **凭证链路混乱**：SYSTEM/USER provider 混在一起，没有优先级

### 1.2 结论

- **新版**：引入 Provider Registry 动态发现 + 三栏选择器 UI + 统一 API Key 管理面板
- SYSTEM provider（ROOT 配置）优先级高于 USER provider
- 支持 OpenAI/Anthropic/DeepSeek 等多 provider 动态发现

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/llm/providers/registry.ts` | 新增 | Provider 注册表 + 动态模型发现 |
| `features/ai/llm/providers/types.ts` | 修改 | ApiFormat/ModelCatalogEntry 类型定义 |
| `features/ai/llm/model-selector.tsx` | 重写 | 三栏模型选择器 UI |
| `features/ai/ui/model-select/ModelConfigPanel.tsx` | 重写 | API Key 管理 + 模型配置面板 |
| `features/ai/ui/model-select/model-labels.ts` | 新增 | Provider/Category 显示名称配置 |
| `features/ai/ui/model-select/ConfigPanelModelSelect.tsx` | 新增 | 配置面板内的模型选择器 |
| `features/ai/ui/model-select/useModelGrouping.ts` | 新增 | 模型分组逻辑 hook |
| `features/ai/types/modes.ts` | 修改 | AiMode/AiTaskCategory 类型定义 |
| `features/ai/llm/image-generator.ts` | 修改 | 增强多 provider 生图支持 |
| `features/ai/llm/credentials/api-key-store.ts` | 修改 | SYSTEM/USER credential 分离 |
| `features/ai/llm/model-routing.ts` | 修改 | 适配新 provider registry |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | 修改 | 意图检测适配新模式 |
| `features/ai/agents/conversation/nodes/generate-response.ts` | 修改 | 响应生成适配新模型 |
| `features/ai/agents/conversation/edges/routing.ts` | 修改 | 路由边适配新状态 |
| `features/ai/agents/conversation/state.ts` | 修改 | 状态定义适配新模式 |
| `features/ai/tools/index.ts` | 修改 | 工具注册适配新路由 |
| `features/ai/types/index.ts` | 修改 | 类型导出更新 |
| `features/ai/core/context/runtime-state-bridge.ts` | 修改 | 运行时状态桥接 |
| `app/api/ai/providers/route.ts` | 修改 | Provider API 路由 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | 消息 API 适配 |
| `prisma/schema.prisma` | 修改 | 索引和约束 |
| `shared/ui/icons.tsx` | 修改 | 新增图标 |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | AI 对话面板适配 |
| `features/ai/ui/model-select/*.ts` | 若干修改 | hooks 和 index 更新 |
| `features/ai/audio/` | 新增 | 语音/音频功能 (TTS/STT/Realtime) |
| `features/ai/routing/` | 新增 | 任务路由 |
| `app/api/ai/audio/` | 新增 | 音频 API 路由 |

---

## 3. 核心实现

### 3.1 Provider Registry (`features/ai/llm/providers/registry.ts`)

```1:50:features/ai/llm/providers/registry.ts
/**
 * Provider Registry & Dynamic Model Discovery
 *
 * 架构参考:
 * - llm-gateway: credential resolver + transport per provider
 * - cc-switch: ApiFormat = anthropic | openai-chat | openai-responses
 *
 * 统一凭证链路：所有模型走 resolveCredential() → createModel()
 * SYSTEM provider（Agnes）存 DB，运行时由 ensureSystemProvider() 初始化
 */
```

**核心设计**：
- `getEnabledModels()` 合并 SYSTEM + USER provider，USER 同 key 时跳过
- `discoverModelsFromAPI()` 从 provider `/v1/models` 动态发现
- `inferCapabilities()` 从 model ID 推断能力（image/video/chat/reasoning）
- Agnes 硬编码模型列表作为 fallback

### 3.2 Model Selector UI (`features/ai/llm/model-selector.tsx`)

```1:50:features/ai/llm/model-selector.tsx
interface ModelSelectorProps {
  value: string;
  onChange: (modelRef: string) => void;
  category?: AiTaskCategory;
  autoMode?: boolean;
  toolMode?: ChatToolMode;
}
```

**三栏布局**：
1. **Category 列**（左）：chat / image / video
2. **Group 列**（中）：chat 用 tier（reasoning/strong/fast），其他用 provider
3. **Model 列**（右）：具体模型列表

### 3.3 API Key 管理 (`features/ai/ui/model-select/ModelConfigPanel.tsx`)

```1:50:features/ai/ui/model-select/ModelConfigPanel.tsx
function ModelConfigPanelInner({ preferredAiModel, availableModels }: ModelConfigPanelInnerProps) {
  const { state, configurableModels, toggleModel, toggleProvider, toggleCategory } = useModelSelection();
  // ...
  const { userKeys, systemKeys, isLoaded, isSaving, saveApiKey, testApiKey } = useApiKeys();
```

**User/System Tab**：
- ROOT 用户可切换 User/System tab
- System tab 配置对所有用户生效
- User tab 配置仅当前用户生效

### 3.4 图片生成 Provider 检测 (`features/ai/llm/image-generator.ts`)

```1:50:features/ai/llm/image-generator.ts
function detectProvider(
  modelRef?: string,
  baseURL?: string
): "dashscope-wan" | "agnes" | "openai-compatible" | "wanx" | "placeholder" {
  // maas.aliyuncs.com + wan2.x → DashScope multimodal-generation
  // agnes + image → apihub.agnes-ai.com
  // compatible-mode / openrouter → OpenAI compatible
}
```

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `NEXT_PUBLIC_` | — | 前端环境变量 |
| Database | PostgreSQL | prisma schema `pm` |
| API Provider | token-plan (阿里云) | MaaS 代理端点 |
| Agnes | apihub.agnes-ai.com | 系统默认模型 |
| 端口 | 3003 | Next.js dev server |
| Background Worker | `npm run worker:background` | 图片生成等后台任务 |

---

## 5. 启动 / 部署

```bash
# 1. 安装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 生成 Prisma Client（如有 schema 改动）
npm run db:generate

# 3. 启动 Next.js 开发服务器
npm run dev

# 4. 启动 Background Worker（图片生成等）
# 新开终端：
npm run worker:background

# 5. 生产构建
npm run build
```

---

## 6. 测试 & 验证

### 6.1 验证模型列表加载

```bash
curl -s http://localhost:3003/api/ai/models | jq '.data | length'
```

**期望输出**：返回可用模型数量 > 0

### 6.2 验证 Provider 注册

```bash
curl -s http://localhost:3003/api/ai/providers | jq
```

**期望输出**：显示已配置的 provider 列表

### 6.3 端到端验证

1. 打开浏览器访问 `http://localhost:3003/ai`
2. 点击模型选择器，验证三栏 UI 显示
3. 切换 Category (chat/image/video)，验证模型列表过滤
4. 进入设置 → AI 配置，验证 API Key 管理面板

### 6.4 图片生成测试

1. 在 AI 面板选择 image 模式
2. 输入提示词：`生成一张风景照片`
3. 点击生成
4. 检查 Background Worker 日志 `[bg-worker]`

---

## 7. 复现 Checklist

- [ ] 拉取最新代码 `git pull origin main`
- [ ] 安装依赖 `npm install`
- [ ] 运行 `npm run db:generate`（如有 schema 改动）
- [ ] 启动 `npm run dev`
- [ ] 启动 `npm run worker:background`（后台任务）
- [ ] 访问 `/ai` 页面验证模型选择器
- [ ] 验证三栏 UI (Category → Group → Model)
- [ ] 测试 Category 切换过滤
- [ ] 访问设置验证 API Key 管理
- [ ] 测试图片生成功能

---

## 8. 踩坑记录

### 坑 1：Agnes Responses API 返回格式不兼容

**现象**：`generateWithAgnes` 调用后 AI SDK 解析失败，报 `input_tokens/output_tokens` 字段缺失

**原因**：Agnes Responses API 返回 `{ prompt_tokens, completion_tokens }`，而 AI SDK 期望 `{ input_tokens, output_tokens }`

**解法**：在 `registry.ts` 添加 `normalizeResponse()` 函数，正则替换字段名

```typescript:features/ai/llm/providers/registry.ts
const normalized = body
  .replaceAll(/"prompt_tokens":(\d+)/g, '"input_tokens":$1')
  .replaceAll(/"completion_tokens":(\d+)/g, '"output_tokens":$1');
```

### 坑 2：生图内容审核被拒

**现象**：生成图片时收到 `content_policy_violation` 或 `DataInspectionFailed` 错误

**原因**：提示词含敏感内容（如真实人物姓名）或图片未通过绿网审核

**解法**：这是模型厂商的预期行为，换用中性提示词

### 坑 3：SYSTEM/USER provider key 相同导致重复发现

**现象**：控制台看到 `USER provider "xxx" skipped (same key as SYSTEM)`

**原因**：当 SYSTEM 和 USER 配置了相同的 API key 时，USER provider 被跳过避免重复

**解法**：这是预期行为，如需使用不同 key 可在 USER 中配置不同的 baseURL

### 坑 4：Background Worker 未启动导致任务卡住

**现象**：图片生成 API 返回 200，但轮询状态一直 `QUEUED`

**原因**：`npm run dev` 只启动 Next.js，Background Worker 是独立进程

**解法**：新开终端运行 `npm run worker:background`

---

## 附录：相关文件路径

```
features/ai/
├── llm/
│   ├── providers/
│   │   ├── registry.ts      # Provider 注册表
│   │   └── types.ts        # 类型定义
│   ├── model-selector.tsx   # 模型选择器
│   ├── model-routing.ts     # 模型路由
│   ├── image-generator.ts   # 图片生成
│   └── credentials/
│       └── api-key-store.ts # 凭证存储
├── ui/
│   ├── model-select/
│   │   ├── ModelConfigPanel.tsx   # 配置面板
│   │   ├── ConfigPanelModelSelect.tsx
│   │   ├── model-labels.ts        # 显示名称
│   │   └── useModelGrouping.ts    # 分组 hook
│   └── AiChatPanel.tsx     # AI 对话面板
├── agents/
│   └── conversation/       # Agent 状态机
├── types/
│   └── modes.ts           # 模式类型定义
└── audio/                  # 语音/音频 (新增)
    ├── tts/
    ├── stt/
    └── realtime/

app/api/ai/
├── models/route.ts
├── providers/route.ts
├── audio/
│   ├── synthesize/route.ts
│   ├── transcribe/route.ts
│   └── realtime/config/route.ts
└── generate/image/route.ts

worker/
├── index.ts              # IndexJob Worker
└── background/
    ├── index.ts          # Background Worker
    └── handlers/
        └── image.handler.ts
```
