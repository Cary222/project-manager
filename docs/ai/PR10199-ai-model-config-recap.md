# AI 模型配置层（#10199）开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + AI SDK 3.x + LangGraph）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能完整复现"AI 模型配置层"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **问题 1（本次修复）**：DeepSeek 模型在 AI 聊天界面下拉框中不显示。用户已配置 API Key 并导入 DeepSeek provider，但 discoverModelsFromAPI 返回认证失败（实际是 key 过期或错误），而即使 key 正确，调用时也返回 404 Not Found。
- **问题 2（旧版设计）**：所有模型统一用 `@ai-sdk/openai` 的 `createOpenAI` 创建实例，但 AI SDK 3.x 会往请求体里注入 `store: true`、`reasoning: {}` 等 OpenAI 特有字段，DeepSeek API 不认识这些字段，返回 404。
- **问题 3（代理混淆）**：`agnes-provider.ts` 和 `summarizer.ts` 各自定义了一套 proxy fetch 逻辑，Agnes 和外部 provider（DeepSeek 等）混用同一套 proxy，导致外部 API 超时。

### 1.2 结论

- 引入 `@ai-sdk/deepseek` 原生 provider，DeepSeek 模型走专用 SDK，不再经过 `@ai-sdk/openai`。
- 统一 proxy 逻辑到 `features/ai/llm/proxy.ts`，Agnes 走代理，外部用户 provider 直连。
- 建立完整的 Provider/Model 配置层（credentials → registry → model-runtime-config → UI selector）。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/llm/providers/registry.ts` | 修改 | Provider 注册表 + 动态模型发现 + createModel 工厂（核心改动：DeepSeek 专用 provider） |
| `features/ai/llm/proxy.ts` | 新增 | 统一的 proxy fetch 逻辑，Agnes 走代理，外部 provider 直连 |
| `features/ai/llm/agnes-provider.ts` | 修改 | 改用 `proxy.ts` 中的 `buildProxyAwareFetch`，删除冗余 proxy 逻辑 |
| `features/ai/llm/summarizer.ts` | 修改 | 改用 `proxy.ts` 中的 `proxyFetch`，删除冗余 proxy 逻辑 |
| `features/ai/llm/credentials/api-key-store.ts` | 新增 | 用户 API Key 凭证存储与解析层 |
| `features/ai/llm/providers/user-providers.ts` | 新增 | 用户 Provider（DeepSeek/OpenRouter/Groq 等）的配置管理 |
| `features/ai/llm/providers/system-providers.ts` | 新增 | SYSTEM Provider（Agnes）的 DB 初始化 |
| `features/ai/llm/providers/types.ts` | 新增 | Provider/Model 类型定义 |
| `features/ai/llm/model-routing.ts` | 新增 | 模型路由选择逻辑（按 taskType 分发到不同模型） |
| `features/ai/llm/model-runtime-config.ts` | 新增 | 运行时模型配置（从 DB 读取用户选择） |
| `features/ai/llm/model-selector.tsx` | 新增 | 模型选择器 UI 组件 |
| `features/ai/graph/nodes/model-select.ts` | 新增 | LangGraph 模型选择节点 |
| `features/ai/graph/edges/routing.ts` | 修改 | LangGraph 路由边（增加 model-select 分支） |
| `features/ai/graph/agent.ts` | 修改 | Agent State 增加 modelContext 字段 |
| `features/ai/graph/nodes/generate-response.ts` | 修改 | 改用统一的 `createModel` 工厂，删除硬编码 Agnes |
| `features/ai/ui/model-select/` | 新增 | 模型选择 UI 组件集（Dropdown / ConfigPanel / ModelList 等） |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | 接入模型选择器 UI |
| `app/api/ai/providers/route.ts` | 新增 | Provider CRUD API |
| `app/api/ai/models/route.ts` | 新增 | 模型列表 API |

---

## 3. 核心实现

### 3.1 `registry.ts` — Provider 工厂与模型发现

```11:31:features/ai/llm/providers/registry.ts
export function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/$/, "");
  if (!trimmed.includes("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}
```

**为什么这样写**：DeepSeek API 路径不带 `/v1`，但 AI SDK 需要 `/v1/chat/completions`。统一在这里做一次 baseURL 规范化，确保 discovery 和实际调用路径一致。

```138:201:features/ai/llm/providers/registry.ts
export async function discoverModelsFromAPI(options: {
  provider: string;
  baseURL: string;
  apiKey: string;
  transport?: "proxy" | "direct";
}): Promise<ModelCatalogEntry[]> {
```

**为什么这样写**：用户添加 Provider 时，动态从 `/v1/models` 端点拉模型列表，按 provider 分组返回。Discovery 失败只 warn 不 throw，保证部分 provider 故障不影响其他 provider。

```293:300:features/ai/llm/providers/registry.ts
  if (providerId === "deepseek") {
    const deepseek = createDeepSeek({
      apiKey: cred.apiKey,
      baseURL: cred.baseURL,
      fetch: fetchFn,
    });
    return deepseek(modelName) as ...
```

**关键**：这是本次修复的核心。DeepSeek 走 `@ai-sdk/deepseek` 原生 provider，而非 `@ai-sdk/openai`。SDK 会生成 DeepSeek 兼容的请求体，不再带 `store: true` 等不兼容字段。

### 3.2 `proxy.ts` — 统一 Proxy Fetch

```22:78:features/ai/llm/proxy.ts
export function buildProxyAwareFetch(): typeof fetch | undefined {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  const proxyAgent = new ProxyAgent({ uri: proxyUrl });
  return async function proxiedFetch(...): Promise<Response> {
    // ... undici ProxyAgent 实现
    // Agnes Responses API token 字段规范化
  };
}
```

**为什么这样写**：Agnes 返回 `prompt_tokens/completion_tokens`，AI SDK 3.x 期望 `input_tokens/output_tokens`。在 proxy 层统一做字段替换，对上层代码透明。

```109:130:features/ai/llm/proxy.ts
export function buildProviderFetch(providerId: string): typeof fetch | undefined {
  // Agnes API — always proxy if available
  if (isAgnsAPI(AGNES_API_BASE_URL)) {
    return getProxyFetch() ?? globalThis.fetch;
  }
  // User providers (DeepSeek, OpenRouter, etc.) — connect directly
  return undefined;
}
```

**关键设计**：用户配置的外部 provider 永远直连，不走代理。只有 Agnes 走代理，避免 DeepSeek 等外部 API 因代理规则不匹配而超时。

### 3.3 `generate-response.ts` — 统一模型实例创建

```30:54:features/ai/graph/nodes/generate-response.ts
    const { providerId, modelName } = selectModel(taskType, userConfig);
    const modelRef = `${providerId}:${modelName}`;
    console.log(`[generateResponseNode] calling model: providerId=${providerId} modelName=${modelName} modelRef=${modelRef}`);

    const model = await createModel({ userId, modelRef });
    const result = await generateText({ model, system: systemPrompt, messages });
```

**为什么这样写**：删除了原来硬编码 Agnes 的逻辑，所有模型（SYSTEM + USER）统一走 `createModel()` 工厂，差异化在 registry 层处理。

### 3.4 Credentials 层（API Key 存储）

```3:20:features/ai/llm/credentials/api-key-store.ts
import { prisma } from "@/shared/db/client";
import { normalizeBaseURL } from "../providers/registry";

export async function resolveCredential(userId: string, provider: string): Promise<{
  apiKey: string;
  baseURL: string;
  transport: "proxy" | "direct";
  apiFormat: "openai-chat" | "anthropic" | "openai-responses";
  ownerType: "SYSTEM" | "USER";
} | null> {
```

**为什么这样写**：凭证解析统一入口，按 ownerType 区分 SYSTEM（Agnes，从 env 读）和 USER（从 DB 读）。返回的结构包含 `transport` 字段，registry 据此决定走代理还是直连。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `AGNES_API_URL` | `https://apihub.agnes-ai.com/v1` | Agnes Cloudflare Worker URL |
| `OPENAI_API_KEY` | `<key>` | Agnes API Key（dev 环境） |
| `HTTPS_PROXY` / `HTTP_PROXY` | `http://localhost:7890` | Clash Verge 代理（可选，Agnes 专用） |
| `@ai-sdk/deepseek` | `^2.0.51` | DeepSeek 原生 SDK |
| `@ai-sdk/openai` | `^4.0.5` | OpenAI / OpenRouter / Groq 等 |
| `@ai-sdk/anthropic` | `^3.0.104` | Claude 系列 |
| 数据库 | PostgreSQL `pm` schema | 存用户 Provider 配置 |

---

## 5. 启动 / 部署

```bash
# 1. 安装 / 更新依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 类型检查（必须通过才能启动）
npx tsc --noEmit

# 3. 启动开发服务器
npm run dev

# 4. 确认服务存活
curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/
# 期望输出: 307（重定向到登录页）
```

---

## 6. 测试 & 验证

### 6.1 Discovery 验证（终端日志）

发送一条 AI 聊天消息，观察终端日志：

```bash
# 在浏览器 http://localhost:3003/ai 发送任意消息
```

**期望日志**：
```
[discoverModelsFromAPI] provider=deepseek baseURL=https://api.deepseek.com → endpoint=https://api.deepseek.com/v1 transport=direct
[getEnabledModels] discovered N models for provider "deepseek": [ 'deepseek-v4-flash', 'deepseek-v4-pro' ]
[createModel] provider=deepseek model=deepseek-v4-flash baseURL=https://api.deepseek.com/v1 transport=direct
[generateResponseNode] using model instance for "deepseek:deepseek-v4-flash", calling generateText...
[generateResponseNode] generateText success, textLen=XXX
```

### 6.2 DeepSeek API 直接验证（curl）

```bash
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer <你的DeepSeek-Key>"
```

**期望**：`{"object":"list","data":[{"id":"deepseek-v4-flash",...},...]}`

### 6.3 Provider 配置保存后验证

在设置中心添加/编辑 DeepSeek Provider，保存后打开 AI 聊天面板下拉框，期望看到 `deepseek-v4-flash`、`deepseek-v4-pro` 等模型选项。

---

## 7. 复现 Checklist

- [ ] `npm install` 确认 `@ai-sdk/deepseek` 版本 `^2.0.51`
- [ ] `npx tsc --noEmit` 类型检查通过
- [ ] `npm run dev` 服务启动成功（端口 3003）
- [ ] 在设置中心添加 DeepSeek Provider，API Key 有效
- [ ] 打开 AI 聊天面板，模型下拉框中能看到 DeepSeek 模型
- [ ] 发送一条消息，终端日志出现 `discoverModelsFromAPI ... transport=direct`
- [ ] 终端出现 `discovered N models for provider "deepseek"`
- [ ] 终端出现 `createModel ... provider=deepseek`
- [ ] 终端出现 `generateText success`，而非 404
- [ ] 前端收到 AI 正常回复（非"生成回答时出错"）

---

## 8. 踩坑记录

### 坑 1：DeepSeek 返回 404 Not Found

**现象**：
```
[generateResponseNode] model failed: {
  message: 'Not Found',
  name: 'AI_APICallError',
  statusCode: 404,
  responseBody: undefined,
  cause: undefined
}
```

**原因**：代码用 `@ai-sdk/openai` 的 `createOpenAI` 调 DeepSeek，AI SDK 3.x 会在请求体里注入 `store: true`、`reasoning: {}` 等 OpenAI 特有字段。DeepSeek API 不认识这些字段，返回 404。

**解法**：在 `registry.ts` 的 `createModel` 中加 `providerId === "deepseek"` 分支，用 `@ai-sdk/deepseek` 的 `createDeepSeek` 替代 `createOpenAI`。

### 坑 2：Discovery 认证失败，但 Key 实际有效

**现象**：
```
[registry] Failed to discover models for provider "deepseek": [deepseek] 获取模型列表失败: Authentication Fails, Your api key: ****4be2 is invalid
```

**原因**：数据库里存的 API Key 是旧的（已过期/被轮换）。用户换了新 Key 但没在设置中心更新。

**解法**：删除设置中心旧的 DeepSeek 配置，用新 Key 重新添加并测试连接。

### 坑 3： Agnes 走代理超时，外部 Provider 也受影响

**现象**：Agnes API 调用正常，但 DeepSeek / OpenRouter 超时。

**原因**：`agnes-provider.ts` 里自定义的 `buildProxyFetch` 没有区分目标服务，所有请求都套了一层 proxy。Clash Verge 的分流规则不包含外部 API 域名，导致超时。

**解法**：统一 proxy 逻辑到 `proxy.ts`，`buildProviderFetch` 只对 Agnes baseURL 走代理，用户外部 provider 返回 `undefined`（直连）。

### 坑 4：Agnes Responses API token 字段名不匹配

**现象**：AI SDK 3.x 解析 Agnes 响应时报 Zod 验证错误。

**原因**：Agnes 返回 `{"prompt_tokens": N, "completion_tokens": M}`，AI SDK 3.x 期望 `{"input_tokens": N, "output_tokens": M}`。

**解法**：在 `proxy.ts` 的 `proxiedFetch` 返回前，用 `replaceAll` 做字段名规范化。
