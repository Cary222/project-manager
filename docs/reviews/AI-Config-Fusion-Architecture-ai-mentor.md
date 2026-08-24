# AI Config 融合架构 — ai-learning-mentor 软层审查

> **角色**：ai-learning-mentor（软层 / 架构顾问）
> **审查日期**：2026-08-21
> **依据**：Stage 0 架构分析 + 代码现状调研 + 用户决策

---

## 审查结论

**APPROVED — 方案方向正确，建议按以下调整执行**

分层桥接方案与用户修正后的决策高度一致。6 个审查问题中 4 个通过，2 个需要补充具体执行策略才能确保长期边界清晰。

---

## 6 个问题的审查结果

### Q1: ProjectHub / Pi 的边界是否清晰

**结论**：✅ **通过，但有一个关键隐患需要 P0 立即处理**

当前边界设计符合用户决策：
- Pi = 独立 SubAgent Runtime（`transports/sdk.ts` 继续用 Pi SDK）
- ProjectHub = 共享 AI 能力（CredentialService / Discovery / Catalog / Registry）

**隐患**：`lib/models-config-store.ts`（第 7 行）仍然动态 import Pi SDK：

```typescript
// lib/models-config-store.ts:6-9
async function getAgentDir(): Promise<string> {
  const { getAgentDir: piGetAgentDir } = await import("@earendil-works/pi-coding-agent");
  return piGetAgentDir();
}
```

这违反了"lib 是最底层"的原则。如果 Pi 升级导致 `getAgentDir()` 路径变化，整个 ProjectHub 的 AI 配置层都会受影响。

**建议**：P0 解耦时，`models-config-store.ts` 应改为：
1. 不再 import Pi SDK
2. `models.json` 路径改为可配置的环境变量
3. 或者彻底移除该文件，因为 ProjectHub 的 Source of Truth 是 `UserApiKey` 表

---

### Q2: Shared AI Platform 是否过度耦合 Pi

**结论**：✅ **通过**

- `lib/model-catalog.ts`（415 行）和 `lib/model-discovery.ts`（93 行）是无 Pi 依赖的纯逻辑库
- Pi UI 层通过重导出使用这两个库，方向正确（UI 依赖 lib，而非反过来）
- Stage 0 报告已识别的循环依赖（`lib/models-config-store.ts → @earendil-works/pi-coding-agent`）属于 Q1 的 P0 项

---

### Q3: models.json 是否被误当成 Source of Truth

**结论**：✅ **通过，但需要文档化**

用户决策已明确：models.json 是 **Pi Runtime 的 Local Compatibility Configuration**，不是 ProjectHub 的业务数据源。代码现状也支持这一点——`transports/sdk.ts` 读的是 `UserApiKey` 表，不是 models.json。

**补充建议**：
1. 在 `lib/models-config-store.ts` 文件头加 JSDoc 说明职责边界
2. 将此说明同步到 `docs/ai/` 的某篇 PR 文档中，形成可追溯的决策记录
3. 避免未来有人把 models.json 当成"第二个 DB"来用

---

### Q4: Provider / Model / Credential 是否职责清晰

**结论**：⚠️ **部分通过，需要 P1 统一凭证查询路径**

当前状态：
- `api-key-store.ts`：三级降级凭证解析（SOURCE of TRUTH）
- `transports/sdk.ts`：既有 Prisma 直接查询（第 272-287 行），又调用 `resolveCredentialWithFallback`（第 269 行）

**根本问题**：`transports/sdk.ts` 第 272-287 行自己写了 Prisma 查询，而不是完全依赖 `api-key-store.ts`：

```typescript
// transports/sdk.ts:272-287（与 api-key-store.ts 重复）
const userProviderRecords = await prisma.userApiKey.findFirst({
  where: { userId, deletedAt: null },
});
const systemCreds = await prisma.userApiKey.findMany({
  where: { ownerType: "SYSTEM", deletedAt: null },
});
```

两处 `ModelCatalogEntry` 类型定义也不同（业务元数据 vs 注册模型），但这是**设计意图差异**而非重复——前者描述模型能力/成本，后者描述运行时注册状态。不需要合并。

**P1 必须执行**：`transports/sdk.ts` 完全通过 `api-key-store.ts` 访问凭证，不直接写 Prisma 查询。

---

### Q5: 未来增加 Claude/Codex/其他 SubAgent 是否容易

**结论**：✅ **通过，架构已支持多租户/多 Agent**

- Discovery / Catalog / Registry 都是无状态逻辑
- `UserApiKey` 表天然支持多用户（通过 `userId` 隔离）
- Pi SubAgent 通过 `provider` 参数选择不同模型

**潜在限制**：`models-config-store.ts` 的 `getAgentDir()` 返回固定路径（全局单租户），但这不影响多用户凭证管理——后者走的是 `UserApiKey` 表。

**架构已为多 Agent 做好准备**，只要未来的 Claude SubAgent 接入 `CredentialService` 即可。

---

### Q6: UI 重构是否保持 ProjectHub 产品初心

**结论**：⚠️ **部分通过，需要控制 Pi UX 吸收的范围**

`ModelsConfig.tsx`（2317 行）的核心价值：
- ✅ Provider 图标映射（40+ provider）
- ✅ 成本表单 UX（模型价格配置）
- ✅ OAuth 登录流程（`OAuthLoginState` 状态机）

**需要警惕的过度复杂性**：
- `ModelsConfig.tsx` 第 99-157 行定义了 6 个接口（`OAuthProvider` / `ApiKeyProvider` / `ModelEntry` / `ProviderEntry` / `ModelsJson` / `ModelTestState`），其中部分与 ProjectHub 已有类型重叠
- `ModelsConfig.tsx` 第 185-200 行有本地 UI 状态管理逻辑，这些逻辑未来可能与 ProjectHub 的 `model-select/` 模块冲突

**建议**：
1. Provider 图标映射（`PROVIDER_ICONS`）提取为独立文件 `lib/provider-icons.ts`，ProjectHub 全局复用
2. `ModelsConfig.tsx` 的 UI 状态管理逻辑需要评估是否与现有 `model-select/` 冲突
3. 不建议把 2317 行全部"吸收"进来，而是选择性提取最有价值的部分

---

## 风险提示

### 🔴 高优先级（阻塞 P0）

| 风险 | 描述 | 缓解 |
|------|------|------|
| **循环依赖未解除** | `models-config-store.ts` → `@earendil-works/pi-coding-agent` | P0-1 立即解耦，移除 Pi SDK 依赖 |

### 🟡 中优先级（影响 P1 质量）

| 风险 | 描述 | 缓解 |
|------|------|------|
| **凭证查询路径不统一** | `transports/sdk.ts` 直接写 Prisma 查询 | P1 统一到 `api-key-store.ts` |
| **Pi UI 复杂性渗透** | 2317 行组件被大量吸收 | P2 选择性提取，控制范围 |

### 🟢 低优先级（可接受）

| 风险 | 描述 | 缓解 |
|------|------|------|
| **类型定义轻微重复** | 两处 `ModelCatalogEntry` 结构不同 | 设计意图差异，可接受 |

---

## 建议调整

### 强制调整（P0 必须执行）

1. **`lib/models-config-store.ts` 解耦 Pi SDK**
   - 不再动态 import `@earendil-works/pi-coding-agent`
   - `models.json` 路径改为环境变量或固定路径
   - 或者：评估是否需要完全移除该文件（ProjectHub 已有 `UserApiKey` 作为 Source of Truth）

### 推荐调整（P1 建议执行）

2. **`transports/sdk.ts` 凭证查询统一**
   - 完全通过 `api-key-store.ts` 的 `resolveCredentialWithFallback()` 访问凭证
   - 移除第 272-287 行的 Prisma 直接查询代码

3. **models.json 职责边界文档化**
   - 在 `lib/models-config-store.ts` 文件头加 JSDoc 说明
   - 说明：此文件仅用于 Pi Runtime 的 Local Compatibility Configuration，不作为 ProjectHub 业务数据源

### 可选调整（P2 视情况执行）

4. **Provider 图标映射提取**
   - 将 `PROVIDER_ICONS` 从 `ModelsConfig.tsx` 提取到 `lib/provider-icons.ts`
   - ProjectHub 全局复用

5. **`ModelsConfig.tsx` 与 `model-select/` 模块冲突评估**
   - 评估两者的 UI 状态管理是否有重叠
   - 决定是合并还是共存

---

## 总结

方案架构方向正确，用户决策（分层桥接 + Pi SubAgent 独立）与代码现状高度吻合。核心风险集中在 P0 的循环依赖解除和 P1 的凭证查询统一。完成这两项后，架构边界将完全清晰，为未来多 Agent 扩展奠定坚实基础。

UI 层（ModelsConfig.tsx）的吸收需要克制，优先提取 Provider 图标等高价值资产，避免引入 Pi 的整体复杂性。

---

> **审查者**：ai-learning-mentor（软层 / 架构顾问）
> **产出**：`docs/reviews/AI-Config-Fusion-Architecture-ai-mentor.md`
