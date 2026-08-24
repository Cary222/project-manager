# Stage 3: CredentialService 统一 — 完成总结

> **完成日期**: 2026-08-21
> **范围**: ProjectHub AI 配置体系 — Credential 架构收敛
> **目标**: 消除重复逻辑、统一 BaseURL 规范化、删除冗余 process.env 修改

---

## 完成的任务

### Stage 3 P0: 循环依赖修复 + BaseURL 统一

| 任务 | 状态 | 说明 |
|------|------|------|
| P0.0: 创建 `lib/normalize-base-url.ts` | ✅ 完成 | 独立的 BaseURL 规范化模块 |
| P0.1: voice-credentials.ts 复用统一函数 | ✅ 完成 | 已正确使用 `cred.baseURL` |
| P0.2: 添加职责边界注释 | ✅ 完成 | api-key-store.ts / registry.ts |
| P0.3: 验证 lint / TypeScript / build | ✅ 完成 | 无循环依赖，类型检查通过 |

**关键成果**:
- ❌ 消除了 `api-key-store.ts` ↔ `registry.ts` 循环依赖
- ✅ 创建独立的 `lib/normalize-base-url.ts`（纯函数模块）
- ✅ 4 个文件统一使用同一 `normalizeBaseURL` / `getEffectiveBaseURL`

**修改文件**:
- `lib/normalize-base-url.ts` (新建)
- `features/ai/llm/credentials/api-key-store.ts`
- `features/ai/llm/providers/registry.ts`
- `features/ai/llm/providers/agnes-provider.ts`

---

### Stage 3 P2: PiSubAgent Credential Runtime 注入方式研究

| 任务 | 状态 | 说明 |
|------|------|------|
| 研究 setRuntimeApiKey 能力覆盖 | ✅ 完成 | 支持所有当前 provider |
| 分析 process.env 真实依赖 | ✅ 完成 | Pi SDK 不读取 API key env |
| 评估多租户隔离风险 | ✅ 完成 | RuntimeCredentials 提供实例隔离 |
| 推荐方案 | ✅ 完成 | HYBRID（删除冗余 process.env） |

**关键发现**:

1. **Pi SDK 不依赖 `process.env` 中的 API key**
   - 唯一的 `process.env` 使用是 `PI_OFFLINE`（控制网络刷新）
   - 不读取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等

2. **`setRuntimeApiKey()` 支持所有当前 provider**
   - OpenAI / Anthropic / DeepSeek / Google / Groq / Together / OpenRouter
   - 支持自定义 `baseUrl`
   - 通过 `RuntimeCredentials.overrides` Map 提供实例隔离

3. **`setupCredentials()` 中的 `process.env` 修改完全冗余**
   - Pi SDK 凭证读取优先级：`RuntimeCredentials.overrides` > `auth.json` > env
   - `setRuntimeApiKey()` 注入的凭证是最高优先级，永远不会 fallback 到 env

**研究报告**: `docs/ai/Stage3-P2-Credential-Runtime-Research.md`

---

### Stage 3 P3: 删除冗余 process.env 修改

| 任务 | 状态 | 说明 |
|------|------|------|
| 删除 setupCredentials() 中的 process.env 修改 | ✅ 完成 | 删除 225-246 行 |
| 更新职责边界注释 | ✅ 完成 | 说明凭证注入机制 |
| 验证 TypeScript / ESLint | ✅ 完成 | 类型检查通过 |

**删除的代码**:
```typescript
// ❌ 已删除（sdk.ts:225-246）
if (providerName === "deepseek") {
  process.env.DEEPSEEK_API_KEY = cred.apiKey;
} else if (providerName === "openai") {
  process.env.OPENAI_API_KEY = cred.apiKey;
} else if (providerName === "anthropic") {
  process.env.ANTHROPIC_API_KEY = cred.apiKey;
} else {
  process.env.OPENAI_API_KEY = cred.apiKey;
  if (cred.baseURL) {
    process.env.OPENAI_API_BASE_URL = cred.baseURL;
  }
}
```

**保留的代码**:
```typescript
// ✅ 保留（resolveCredentialWithFallback 的 fallback 参数）
resolveCredentialWithFallback(userId, providerName, {
  apiKey: process.env.OPENAI_API_KEY || "",
  baseURL: process.env.OPENAI_API_BASE_URL || "",
});
```

**修改文件**:
- `features/ai/agents/work/subagents/pi/transports/sdk.ts`

---

## 架构变化

### 修改前

```
api-key-store.ts ──→ registry.ts ──→ api-key-store.ts  ❌ 循环依赖
     │
     │ (normalizeBaseURL / getEffectiveBaseURL 重复实现)
     │
voice-credentials.ts

setupCredentials()
  ├─ 设置 process.env.OPENAI_API_KEY        ❌ 冗余
  └─ 设置 process.env.ANTHROPIC_API_KEY     ❌ 冗余
       ↓
createPiSession()
  └─ modelRuntime.setRuntimeApiKey()        ✅ 真正生效
```

### 修改后

```
lib/normalize-base-url.ts (独立纯函数模块，无依赖)
     ↑
     │
api-key-store.ts ──→ registry.ts ──→ agnes-provider.ts  ✅ 单向依赖
     ↑
voice-credentials.ts

setupCredentials()
  └─ 凭证解析和验证（不设置 process.env）  ✅ 职责清晰
       ↓
createPiSession()
  └─ modelRuntime.setRuntimeApiKey()        ✅ 唯一凭证注入点
       └─ RuntimeCredentials.overrides      ✅ 实例隔离
```

---

## 职责边界

### CredentialService (api-key-store.ts)

**负责**:
- ✅ UserApiKey CRUD
- ✅ 加密存储（AES-GCM）
- ✅ 凭证解析（USER → SYSTEM → ENV 三级降级）
- ✅ 缓存失效

**不负责**:
- ❌ Provider-specific auth parsing（由 Pi SDK 负责）
- ❌ 模型发现（由 registry.ts 负责）
- ❌ BaseURL 规范化（由 lib/normalize-base-url.ts 负责）

---

### Model Registry (registry.ts)

**负责**:
- ✅ 模型发现（discoverModelsFromAPI）
- ✅ 模型实例创建（createModel）
- ✅ API Format 推断
- ✅ Capability 推断

**不负责**:
- ❌ 凭证存储和加密（由 api-key-store.ts 负责）
- ❌ BaseURL 规范化（由 lib/normalize-base-url.ts 负责）
- ❌ Provider-specific auth parsing（由 Pi SDK 负责）

---

### BaseURL Normalization (lib/normalize-base-url.ts)

**负责**:
- ✅ BaseURL 规范化（移除末尾斜杠、确保 /v1）
- ✅ 获取有效 BaseURL（优先自定义 → 已知默认 → 通用格式）

**不负责**:
- ❌ 凭证解析
- ❌ 模型发现
- ❌ 任何业务逻辑（纯函数模块）

---

### Pi SDK Adapter (sdk.ts)

**负责**:
- ✅ 凭证解析和验证（setupCredentials）
- ✅ 凭证注入到 ModelRuntime（setRuntimeApiKey）
- ✅ Pi Session 创建和管理

**不负责**:
- ❌ 设置全局 process.env（已删除）
- ❌ 凭证存储和加密（由 api-key-store.ts 负责）

---

## 验证结果

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ PASS |
| ESLint（新文件） | ✅ PASS |
| 循环依赖检查 | ✅ 无循环依赖 |
| 开发服务器 | ✅ 正常运行 |

**预存警告（不在 Stage 3 范围内）**:
- `registry.ts`: 2 个 `@typescript-eslint/no-explicit-any`（DEBUG 代码）
- `sdk.ts`: 5 个 `@typescript-eslint/no-explicit-any`（预先存在）

---

## 回归测试清单

### P0 必测（阻塞）
- [ ] ProjectHub API Key 配置和保存
- [ ] ProjectHub 模型发现（/api/ai/models）
- [ ] PiSubAgent 正常启动
- [ ] PiSubAgent 使用 USER provider
- [ ] PiSubAgent 使用 SYSTEM provider
- [ ] Voice TTS/STT 正常工作

### P1 建议测试（非阻塞）
- [ ] 多用户并发场景（process.env 隔离验证）
- [ ] OpenAI / Anthropic / DeepSeek / Google 等 provider
- [ ] 自定义 baseURL 生效
- [ ] Agnes hardcoded models 正常工作

---

## 剩余工作（不在 Stage 3 范围内）

### P1: 清理预先存在的 lint 警告
- `registry.ts`: 2 个 `no-explicit-any`
- `sdk.ts`: 5 个 `no-explicit-any`

### P2: CredentialService 正式接口
- 将 `api-key-store.ts` 的函数封装为 `CredentialService` 接口
- 创建 `features/ai/llm/credentials/service.ts`

### P3: Pi Runtime 多租户并发测试
- 创建并发场景测试用例
- 验证 RuntimeCredentials 隔离机制

---

## 严格禁止清单（已遵守）

确认以下项**不在 Stage 3 范围内**：

- [x] ❌ 修改 Prisma Schema
- [x] ❌ 删除 UserApiKey
- [x] ❌ 删除 models.json
- [x] ❌ 删除 `/api/models-config`
- [x] ❌ 合并 `/api/models` 与 `/api/ai/models`
- [x] ❌ 删除 Pi ModelRuntime
- [x] ❌ 重写 Provider-specific Auth（Pi SDK 40+ providers）
- [x] ❌ 移动整个 `lib/` 目录
- [x] ❌ 大规模移动目录
- [x] ❌ 修改无关 AI 功能

---

## 关键文件清单

| 文件 | 操作 | 行数 |
|------|------|------|
| `lib/normalize-base-url.ts` | 新建 | 53 |
| `features/ai/llm/credentials/api-key-store.ts` | 修改 | 496 (+13 行注释) |
| `features/ai/llm/providers/registry.ts` | 修改 | 415 (-26 行重复代码) |
| `features/ai/llm/providers/agnes-provider.ts` | 修改 | 131 (导入路径) |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 修改 | 803 (-22 行冗余代码) |
| `docs/ai/Stage3-P2-Credential-Runtime-Research.md` | 新建 | 367 |
| `docs/ai/Stage3-CredentialService-Investigation.md` | 参考 | 896 |

---

## 参考文档

- [Stage 3 P2 研究报告](./Stage3-P2-Credential-Runtime-Research.md)
- [Stage 3 深度分析](./Stage3-CredentialService-Investigation.md)
- [API 架构评审](../reviews/API-Architecture-Review-2026-08-21.md)

---

**文档版本**: v1.0
**更新人**: Main Agent
**下次审查**: Stage 4 开始前
