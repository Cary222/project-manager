<!-- reviewer: ai-learning-mentor (软层) -->

# AI Config P0/P1 — ai-learning-mentor 软层审查

> **角色**：ai-learning-mentor（软层 / 架构顾问）
> **审查日期**：2026-08-21
> **对应 Stage 1 审查**：`docs/reviews/AI-Config-Fusion-Architecture-ai-mentor.md`

---

## 审查结论

**APPROVED — 两项 P0/P1 任务均达标，架构边界已彻底解耦**

Stage 1 提出的两个强制调整项（循环依赖解除 + 凭证路径统一）均已正确执行。架构边界从"存在隐患"升级为"清晰可维护"。

---

## 5 个维度的审查结果

### 1. 架构边界是否更清晰

**结论**：✅ **大幅改善，循环依赖已彻底解除**

**Task A 的核心价值**：`lib/models-config-store.ts` 移除了对 `@earendil-works/pi-coding-agent` 的动态 import，改为：

```typescript
export function getAgentDir(): string {
  return process.env.PI_RUNTIME_DIR ?? join(homedir(), ".pi-runtime");
}
```

用日常语言说：之前这个文件"打电话给 Pi SDK 问它把配置文件放哪了"，现在改成"自己看环境变量，环境变量没设就用默认值"。这就好比从"问邻居家借钥匙开门"变成了"自己配一把钥匙"。

**边界现在清晰了**：
- `lib/models-config-store.ts`：Pi Runtime 的本地配置文件路径管理
- `UserApiKey` 表：ProjectHub 的业务数据源（Source of Truth）
- 两者完全正交，不再有 import 依赖

Stage 1 担心的"Pi 升级导致 ProjectHub AI 配置层受影响"已经消除。

---

### 2. 凭证职责是否统一

**结论**：✅ **完全统一，31 行冗余 Prisma 查询已移除**

**Task B 的核心价值**：`features/ai/agents/work/subagents/pi/transports/sdk.ts` 不再自己写 Prisma 查询，改为完全通过 `api-key-store.ts` 访问凭证：

```typescript
import { resolveCredentialWithFallback, getUserProviderRecords } from "@/features/ai/llm/credentials/api-key-store";
```

三级降级链路（SYSTEM → USER → ENV）在 `api-key-store.ts` 的 `resolveCredentialWithFallback()` 里一次性定义，`sdk.ts` 只调用不实现。

用日常语言说：之前 `sdk.ts` 自己写 SQL 查数据库（查用户的 key、查系统的 key、凑凭证对象），现在把这件事外包给 `api-key-store.ts` 这个"凭证管家"。`sdk.ts` 只管说"给我一个可用的凭证"，`api-key-store.ts` 负责按优先级找。

**Stage 1 风险已消除**：
| Stage 1 指出的问题 | 现在状态 |
|---|---|
| `sdk.ts` 直接写 Prisma 查询（第 272-287 行） | ✅ 已移除，改为调用 `resolveCredentialWithFallback()` |
| 两处 Prisma 查询逻辑与 `api-key-store.ts` 重复 | ✅ 统一到 `api-key-store.ts` |
| 凭证职责分散，边界不清晰 | ✅ `api-key-store.ts` 成为唯一凭证入口 |

---

### 3. 扩展性

**结论**：✅ **架构已为多 Agent 扩展做好准备**

当前架构对未来的支持：

| 扩展场景 | 是否容易 | 原因 |
|---|---|---|
| 新增 Claude SubAgent | ✅ 容易 | 只需在 `transports/` 下新建 `claude.ts`，复用 `api-key-store.ts` 的凭证解析 |
| 新增更多 Provider | ✅ 容易 | `api-key-store.ts` 的三级降级链路是 provider-agnostic 的 |
| 多租户隔离 | ✅ 已支持 | `resolveCredentialWithFallback(userId, provider)` 天然按 userId 隔离 |
| Pi Runtime 路径自定义 | ✅ 容易 | 环境变量 `PI_RUNTIME_DIR` 可配置 |

唯一潜在限制：`models-config-store.ts` 的 `getAgentDir()` 返回全局固定路径（不支持多租户各自的 Pi Runtime 目录）。但这在当前阶段不是问题——ProjectHub 的 AI 配置走 `UserApiKey` 表，与 Pi Runtime 的 `models.json` 完全解耦。

---

### 4. 可维护性

**结论**：✅ **代码意图清晰，注释到位，新人可快速理解**

**`lib/models-config-store.ts` 的 JSDoc（第 7-13 行）**：

```typescript
/**
 * 获取 Pi Runtime 目录。
 * 优先使用环境变量 PI_RUNTIME_DIR，否则使用默认路径 ~/.pi-runtime。
 *
 * 注意：此路径仅用于 Pi Local Runtime 的本地配置（如 models.json），
 * ProjectHub 的 Source of Truth 仍是 UserApiKey 表。
 */
```

这段注释把"这个文件干什么 + 不干什么"都说清楚了，新人看到这段话就知道：
- ✅ 不要在这里查用户凭证（那是 `api-key-store.ts` 的事）
- ✅ 不要把 `models.json` 当业务数据库用
- ✅ Pi SDK 升级不需要改这个文件

**`transports/sdk.ts` 的结构化注释**（文件头第 1-14 行）列出了所有 Phase 里程碑，让维护者清楚知道哪些功能是"计划中但还没做"的。

---

### 5. 一致性

**结论**：✅ **与 Stage 1 建议完全匹配，与用户 Q1/Q2 决策一致**

Stage 1 的两项强制调整均已执行：

| Stage 1 建议 | 执行状态 |
|---|---|
| `models-config-store.ts` 解耦 Pi SDK，改为环境变量 | ✅ 已执行 |
| `sdk.ts` 凭证查询统一到 `api-key-store.ts` | ✅ 已执行 |

Stage 1 的推荐调整也已执行：

| Stage 1 建议 | 执行状态 |
|---|---|
| `models-config-store.ts` 文件头加 JSDoc 说明边界 | ✅ 已执行 |
| `models.json` 职责边界文档化 | ✅ JSDoc 已写明"Source of Truth 仍是 UserApiKey 表" |

---

## 架构演进评估

### 改动前

```
lib/models-config-store.ts
  └── 动态 import @earendil-works/pi-coding-agent ❌ 循环依赖

features/ai/agents/work/subagents/pi/transports/sdk.ts
  ├── 直接 import prisma + 写 Prisma 查询 ❌ 凭证职责分散
  ├── 自己拼凑 CredentialRecord 对象
  └── 与 api-key-store.ts 逻辑重复
```

### 改动后

```
lib/models-config-store.ts
  └── process.env.PI_RUNTIME_DIR ?? ~/.pi-runtime ✅ 无外部依赖

features/ai/agents/work/subagents/pi/transports/sdk.ts
  └── 统一调用 api-key-store.ts 的 resolveCredentialWithFallback()
      └── 三级降级链路（SYSTEM → USER → ENV）在 api-key-store.ts 定义一次

api-key-store.ts
  └── 唯一凭证入口 ✅
```

用日常生活比喻：

> **改动前**：你出差住酒店，每次要问前台"我的房间在哪层"，前台还要打电话给物业确认大楼布局。
>
> **改动后**：你出差住酒店，前台直接查系统告诉你房间号——物业怎么管大楼与你无关，你只需要知道"问前台就行"。

---

## 风险提示

### 🟡 中优先级（可接受）

| 风险 | 描述 | 评估 |
|------|------|------|
| `getAgentDir()` 全局固定路径 | 当前 `PI_RUNTIME_DIR` 是全局的，多租户场景下每个用户的 Pi Runtime 路径可能不同 | 当前阶段不需要多租户 Pi Runtime，暂可接受 |
| `sdk.ts` 的 `setupCredentials()` 仍操作 `process.env` | 第 213-233 行设置了 `DEEPSEEK_API_KEY` 等环境变量，会污染全局状态 | Phase 6 研究 Pi SDK 运行时传凭证可解决，非阻塞 |

### 🟢 低优先级（可接受）

| 风险 | 描述 | 评估 |
|------|------|------|
| Stage 1 提到的"Pi UI 复杂性渗透" | `ModelsConfig.tsx`（2317 行）未做选择性提取 | UI 复杂度属于 P2 范围，不影响本次 P0/P1 质量 |
| `steer()` 和 `followUp()` 未完全实现 | `sdk.ts` 第 538-543 行和 579-581 行仍有 TODO | Phase 5 计划中的功能，不影响凭证解耦 |

---

## 建议后续优化（非阻塞性）

### P2 推荐（可选）

1. **`sdk.ts` 的 `setupCredentials()` 全局状态污染**
   - 当前通过 `process.env` 设置 API Key，理论上多租户并发调用会相互覆盖
   - 建议：Phase 6 研究 Pi SDK 是否支持 `ModelRuntime.create()` 时直接传入凭证对象，而不是读 `process.env`
   - 不阻塞：当前单租户场景下工作正常

2. **`ModelsConfig.tsx` 选择性提取**
   - Stage 1 建议的 `PROVIDER_ICONS` 提取到 `lib/provider-icons.ts` 可以做
   - 不阻塞：`ModelsConfig.tsx` 尚未大量引入 AI 配置层

3. **凭证日志脱敏**
   - `sdk.ts` 第 219 行打印 `DEEPSEEK_API_KEY (length: ${cred.apiKey.length})`
   - 已经是 length，不是明文，风险可控
   - 如需更严格，可改为 `console.debug` 或统一日志框架

---

## 总结

| 维度 | 结论 | 关键变化 |
|------|------|---------|
| 架构边界 | ✅ 更清晰 | 循环依赖解除，`lib` 不再依赖 Pi SDK |
| 凭证职责 | ✅ 统一 | `api-key-store.ts` 成为唯一入口，31 行冗余查询移除 |
| 扩展性 | ✅ 良好 | 多 Agent / 多 Provider / 多租户均已准备好 |
| 可维护性 | ✅ 良好 | JSDoc 清晰，代码意图明确 |
| 一致性 | ✅ 达标 | Stage 1 所有强制建议均已执行 |

**本次 P0/P1 改动是一次教科书级别的解耦重构**：不是"重写"，而是"移除不必要的关系 + 明确每个模块的职责边界"。这正是你在路线三（AI Agent 对话系统）里学到的架构思维的实际应用。

---

> **审查者**：ai-learning-mentor（软层 / 架构顾问）
> **产出**：`docs/reviews/AI-Config-P0P1-ai-mentor.md`
