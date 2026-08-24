# AI Config P0/P1 — 凭证解耦与循环依赖修复复现手册

> **适用**：ProjectHub 仓库（Next.js + Prisma + Pi SDK）
> **目标**：解决 AI Config 循环依赖 + 凭证路径统一，让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**本次 P0/P1 改动的端到端过程。
> **关联 Issue**：无单号（内部架构重构）
> **改动日期**：2026-08-21

---

## 1. 目标 & 背景

### 1.1 旧版的问题

**问题 A — 循环依赖**
- `lib/models-config-store.ts` 动态 import `@earendil-works/pi-coding-agent`
- Pi SDK 依赖 Prisma，Prisma 依赖 `models-config-store`，循环依赖导致：
  - Pi SDK 升级可能破坏 ProjectHub AI 配置层
  - 类型检查不稳定

**问题 B — 凭证职责分散**
- `transports/sdk.ts` 自己写 Prisma 查询查用户凭证（31 行冗余代码）
- 凭证获取逻辑与 `api-key-store.ts` 重复
- 边界不清晰：谁负责获取凭证？谁负责注册凭证？

**问题 C — 类型安全漏洞**
- `transports/sdk.ts` 中 4 处 `as any` 完全绕过 TypeScript 类型检查
- `ModelRuntime.create({...} as any)` 可能隐藏 SDK API 变更的 bug

### 1.2 结论

**新版通过两步彻底解耦**：

1. `models-config-store.ts` 不再依赖 Pi SDK，改为读取 `process.env.PI_RUNTIME_DIR` 或默认值 `~/.pi-runtime`
2. `transports/sdk.ts` 统一通过 `api-key-store.ts` 的 `resolveCredentialWithFallback()` 获取凭证，三级降级链路（SYSTEM → USER → ENV）在 `api-key-store.ts` 定义一次

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 修改 | 解耦凭证获取，移除 Prisma 查询，修复 4 处 `as any` |
| `lib/models-config-store.ts` | 修改 | 移除 Pi SDK 动态 import，改为环境变量 |
| `lib/model-scope.ts` | 无改动 | 验证无影响 |
| `app/api/models/route.ts` | 无改动 | 验证无影响 |
| `app/api/models-config/discover/route.ts` | 无改动 | 验证无影响 |

---

## 3. 核心实现

### 3.1 解耦 `models-config-store.ts`（Task A）

```startLine:1:lib/models-config-store.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";
import { homedir } from "node:os";

/**
 * 获取 Pi Runtime 目录。
 * 优先使用环境变量 PI_RUNTIME_DIR，否则使用默认路径 ~/.pi-runtime。
 *
 * 注意：此路径仅用于 Pi Local Runtime 的本地配置（如 models.json），
 * ProjectHub 的 Source of Truth 仍是 UserApiKey 表。
 */
export function getAgentDir(): string {
  return process.env.PI_RUNTIME_DIR ?? join(homedir(), ".pi-runtime");
}
```

**为什么这样写**：之前这个文件"打电话给 Pi SDK 问它把配置文件放哪了"，现在改成"自己看环境变量，环境变量没设就用默认值"。这就好比从"问邻居家借钥匙开门"变成了"自己配一把钥匙"。

---

### 3.2 凭证统一到 `api-key-store.ts`（Task B）

#### 3.2.1 导入 `resolveCredentialWithFallback` 和 `getUserProviderRecords`

```startLine:16:features/ai/agents/work/subagents/pi/transports/sdk.ts
import { resolveCredentialWithFallback, getApiKey, getUserProviderRecords } from "@/features/ai/llm/credentials/api-key-store";
```

#### 3.2.2 定义 SDK 类型接口替代 `as any`

```startLine:39:features/ai/agents/work/subagents/pi/transports/sdk.ts
/**
 * Pi SDK Transport 类型定义
 * 定义 SDK 类型接口以替代 `as any` 类型断言
 */

/**
 * createPiSession 的参数类型（对应 SDK 的 CreateAgentSessionOptions）
 */
type PiSessionOptions = Pick<
  CreateAgentSessionOptions,
  "cwd" | "modelRuntime" | "model"
>;
```

**为什么这样写**：Pi SDK 的 `CreateAgentSessionOptions` 有很多可选字段，但我们只用 `cwd`、`modelRuntime`、`model` 三个。使用 `Pick<>` 可以精确限定参数范围，既保证类型安全又避免传入多余字段。

#### 3.2.3 三级降级凭证获取

```startLine:269:features/ai/agents/work/subagents/pi/transports/sdk.ts
// ============================================================
// Phase 5 P0 关键修复：从用户 DB 配置获取凭证和模型
// ============================================================

const userId = input.userId || "system";
console.log(`[PiSdkRuntime] Resolving credentials for userId=${userId}`);

// 1. 从用户 API Key 配置获取凭证
// 优先顺序：input.provider → 用户的第一个 provider → SYSTEM fallback
// 使用 api-key-store.ts 的三级降级链路（SYSTEM → USER → ENV）
let providerName = input.provider;
let cred = null;

if (providerName) {
  // 用户指定了 provider，走三级降级
  cred = await resolveCredentialWithFallback(userId, providerName);
} else {
  // 没有指定 provider，获取用户第一个可用 provider
  const userProviders = await getUserProviderRecords(userId);
  if (userProviders.length > 0) {
    providerName = userProviders[0].provider;
    cred = await resolveCredentialWithFallback(userId, providerName);
  }
}
```

**为什么这样写**：三级降级链路（SYSTEM → USER → ENV）保证了：
- 优先使用用户配置的凭证（USER）
- 如果用户没有配置，使用系统级凭证（SYSTEM）
- 如果系统也没有，使用环境变量（ENV）
- 如果都没有，`resolveCredentialWithFallback` 返回 null，sdk.ts 抛出明确错误

#### 3.2.4 注册 API key 到 ModelRuntime

```startLine:299:features/ai/agents/work/subagents/pi/transports/sdk.ts
// 2. 注册 API key 到 ModelRuntime
// Pi SDK 的 provider 名称映射
const sdkProviderName = providerName === "deepseek" ? "openai" : providerName;
const baseUrl = providerName === "deepseek"
  ? "https://api.deepseek.com"
  : cred.baseURL;

console.log(`[PiSdkRuntime] Registering API key for SDK provider: ${sdkProviderName}`);
await modelRuntime.setRuntimeApiKey(
  sdkProviderName,
  cred.apiKey,
  // @ts-expect-error - SDK AuthOperationOptions 类型定义不包含 baseUrl，但运行时支持此参数
  baseUrl ? { baseUrl } : undefined
);
```

**为什么这样写**：DeepSeek 兼容 OpenAI API，所以 `providerName === "deepseek"` 时需要映射到 `"openai"`。使用 `@ts-expect-error` 而不是 `as any`，因为这是已知的类型定义不完整，而非类型不匹配。

---

### 3.3 C1 修复：4 处 `as any` 类型断言

#### 修复前（行 252, 298, 359）

```typescript
// 修复前
ModelRuntime.create({...} as any)
{ baseUrl } as any
createAgentSession({...} as any)
```

#### 修复后

| 位置 | 修复方式 | 说明 |
|------|---------|------|
| 行 266 | `} as CreateModelRuntimeOptions` | 使用 SDK 导出类型 |
| 行 312 | `@ts-expect-error` + `{ baseUrl }` | 已知类型定义不完整 |
| 行 374 | `} as PiSessionOptions` | 使用 Pick 限定后的类型 |

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `PI_RUNTIME_DIR` | `~/.pi-runtime`（默认） | Pi Local Runtime 配置目录 |
| `DEEPSEEK_API_KEY` | 用户配置 | DeepSeek API Key（可选，环境变量降级） |
| `OPENAI_API_KEY` | 用户配置 | OpenAI API Key（可选） |
| `ANTHROPIC_API_KEY` | 用户配置 | Anthropic API Key（可选） |
| Node.js | >= 18 | 运行时要求 |
| `@earendil-works/pi-coding-agent` | 0.84.2 | Pi SDK 版本 |

---

## 5. 启动 / 部署

### 5.1 本地开发

```bash
# 1. 进入项目目录
cd /Users/vastgui/Desktop/project-manager

# 2. 安装依赖
npm install

# 3. 启动开发服务器（端口 3003）
npm run dev

# 4. 确认服务存活
curl http://localhost:3003/api/health
```

### 5.2 远程生产

```bash
# 1. SSH 到远程服务器
ssh hxy@192.168.1.14

# 2. 进入项目目录
cd /home/hxy/work/personal/project-manager

# 3. Pull 最新代码
git fetch origin
git checkout main
git pull origin main

# 4. Build（必须先 build 再 restart）
npm run build

# 5. 重启服务
systemctl --user restart project-manager.service

# 6. 检查服务状态
systemctl --user status project-manager.service
```

---

## 6. 测试 & 验证

### 6.1 TypeScript 类型检查

```bash
# 在项目根目录运行
npx tsc --noEmit

# 期望输出：无新增 tsc 错误（历史遗留错误可忽略）
# Exit code: 0
```

### 6.2 Lint 检查

```bash
npm run lint

# 期望输出：无 ESLint 错误
# Exit code: 0
```

### 6.3 AI Config 功能验证

1. 打开浏览器访问 `http://localhost:3003`
2. 登录用户账号
3. 进入 AI Workspace 或相关 AI 功能页面
4. 尝试发起一个 AI 对话
5. 验证凭证正确加载（查看控制台 `[PiSdkRuntime] Using X credential for Y` 日志）

---

## 7. 复现 Checklist

- [ ] **Step 1**：拉取最新代码 `git pull origin main`
- [ ] **Step 2**：运行 `npm install` 更新依赖
- [ ] **Step 3**：运行 `npm run build` 确认构建通过
- [ ] **Step 4**：运行 `npx tsc --noEmit` 确认无新增类型错误
- [ ] **Step 5**：启动本地开发服务器 `npm run dev`
- [ ] **Step 6**：访问 `http://localhost:3003` 确认页面可加载
- [ ] **Step 7**：检查控制台是否有 `[PiSdkRuntime] Resolving credentials for userId=` 日志
- [ ] **Step 8**：验证 AI 对话功能正常工作

---

## 8. 踩坑记录

### 坑 1：C1 CRITICAL — 4 处 `as any` 类型断言

**现象**：`transports/sdk.ts` 中多处 `as any` 完全绕过 TypeScript 类型检查

**原因**：Pi SDK 的类型定义不完整，开发者使用 `as any` 快速绕过

**解法**：
1. 定义 `PiSessionOptions` 类型，使用 `Pick<CreateAgentSessionOptions, ...>` 限定参数
2. 使用 `@ts-expect-error` 标注已知类型定义不完整的参数
3. 避免使用 `as any`，保留类型安全检查

**验证**：运行 `npx tsc --noEmit` 无新增错误

---

### 坑 2：C2 CRITICAL — 多租户凭证隔离风险（Phase 6 技术债）

**现象**：`setupCredentials()` 方法通过 `process.env` 全局设置 API key

**原因**：Pi SDK 在 `ModelRuntime.create()` 时读取环境变量，当前架构不支持请求级凭证传递

**解法（已标注为 Phase 6 技术债）**：
1. Phase 6 研究 Pi SDK 是否支持 `ModelRuntime.create()` 时直接传入凭证对象
2. 如果不支持，考虑在调用前清理 `process.env` 或使用请求级隔离
3. 当前阶段：文档明确此模块不支持多租户并发调用

**影响**：单租户场景下正常工作；多租户场景有跨用户凭证泄漏风险

---

### 坑 3：事件队列无上限控制（MAJOR — P1）

**现象**：`createPiEventStream()` 中的 `eventQueue` 是无界数组

**原因**：Pi SDK 事件频率可能高于消费速度，导致队列无限增长

**解法（建议 Phase 6 修复）**：

```typescript
const MAX_QUEUE_SIZE = 1000;
if (eventQueue.length >= MAX_QUEUE_SIZE) {
  console.warn(`[PiSdkRuntime] Event queue full, dropping oldest event`);
  eventQueue.shift();
}
```

---

### 坑 4：`sendUserMessage` 错误未传播（MINOR — P2）

**现象**：行 158-160 的 `sendUserMessage` Promise rejection 仅记录日志

**原因**：错误未向上传播，用户可能看到 run "卡住" 而非收到错误

**解法（建议 Phase 6 修复）**：将错误挂载到 handle 上，或通过事件流发送错误

---

## 附录：审查报告

- **硬层审查**：`docs/reviews/AI-Config-P0P1-code-reviewer.md`
- **软层审查**：`docs/reviews/AI-Config-P0P1-ai-mentor.md`
- **架构分析**：`docs/reviews/AI-Config-Fusion-Architecture-ai-mentor.md`

---

> **文档版本**：v1.0
> **生成时间**：2026-08-21
> **生成者**：Cursor Agent (fullstack-developer)
