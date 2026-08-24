# Stage 7 方案：OAuth Credential DB 化

**日期**: 2026-08-21
**状态**: 方案草案（按 Stage 6 约束"先输出 Schema 变化 / 原因 / 兼容 / 迁移方案，再单独进入 Credential Schema Phase"）

---

## 一、背景与原因

当前 OAuth 凭证（Anthropic / OpenAI Codex / GitHub Copilot 等订阅登录）存储在
Pi Workspace 文件侧（`/api/auth/*` + Pi Runtime 目录），不在 ProjectHub DB：

| 问题 | 说明 |
|------|------|
| 无用户归属 | 文件凭证是机器级的，无法按 userId 隔离；多用户共享部署时互相可见 |
| 无权限/审计 | 不走 ProjectHub 权限体系，删除/替换无记录 |
| 无加密规范 | 未使用 CredentialService 的 AES-256-GCM 加密链路 |
| 跨设备不同步 | 与 UserApiKey 的 DB 持久化体验不一致 |
| UI 割裂 | ModelsConfig 薄壳中 OAuthDetail 仍是 Pi 专属分支，无法进入统一 CredentialForm |

**为什么不复用 UserApiKey**：UserApiKey 语义是"单个 API Key"（encryptedKey/iv/authTag
+ keyLast4/keyHash），而 OAuth 凭证是 **token 集合**（accessToken / refreshToken /
expiresAt / scopes），需要刷新与过期管理。强行塞入 UserApiKey 会破坏其字段语义与
掩码/去重逻辑（违反 Stage 6"不修改 UserApiKey Schema"约束）。

---

## 二、Schema 变化（提案）

新增单表，`pm` schema，不动 UserApiKey：

```prisma
model UserOAuthCredential {
  id          String    @id @default(cuid())
  userId      String
  providerId  String    // anthropic / openai-codex / github-copilot ...
  displayName String?
  loginMethod String    @default("oauth") // oauth | device_code | prompt
  tokens      String    // AES-256-GCM 加密后的 JSON（accessToken/refreshToken/idToken/expiresAt）
  iv          String
  authTag     String
  scopes      String?
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime? // 软删除

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, providerId])
  @@index([userId, deletedAt])
  @@schema("pm")
}
```

要点：
- tokens 用与 UserApiKey 相同的 `encryption.ts`（AES-256-GCM）加密，密钥同源。
- `@@unique([userId, providerId])`：每用户每 provider 一条 OAuth 凭证（与 Pi 登录态语义一致）。
- expiresAt 放 tokens JSON 内（刷新时整体更新），不加冗余列，避免 Schema 再迁移。

---

## 三、兼容方案

1. **CredentialService 扩展（不改旧接口）**：
   - `api-key-store.ts` 保持不变（API Key 链路）。
   - 新增 `features/ai/llm/credentials/oauth-store.ts`：
     `saveOAuthCredential / getOAuthCredential / deleteOAuthCredential / listOAuthProviders(userId)`。
2. **双读阶段**：`/api/auth/providers` 与 `/api/auth/all-providers` 改为
   "DB 优先、Pi 文件回落"合成视图，UI（ModelsConfig 薄壳的 sections）零改动。
3. **OAuth 登录流程**：`/api/auth/login/:id` 的 SSE 流程保持不变（Pi 发起），
   成功回调时把 token 写入 DB（而非文件）；device_code / prompt 分支同理。
4. **ModelSettingsPanel 侧**：OAuthDetail 保持 Pi 分支直至迁移完成；完成后改为
   CredentialForm 的 OAuth 变体（`authMethod: "oauth"`），并入统一 Provider UX。
5. **API Contract**：`/api/auth/*` 响应形状不变（OAuthProvider[] / ApiKeyProvider[]），
   仅数据来源切换。

---

## 四、迁移方案（分 4 步，可独立回滚）

| 步骤 | 内容 | 回滚 |
|------|------|------|
| P1 | Schema 迁移 + oauth-store service + 单测 | drop 表 |
| P2 | 登录回调双写（DB + 文件），读取 DB 优先 | 关双写开关 |
| P3 | 一次性迁移脚本：`scripts/ai/migrate-pi-oauth-to-db.ts` 解析 Pi Runtime 目录中的现有登录态写入 DB（按当前部署用户归属），迁移后校验条数 | 脚本幂等，可重跑 |
| P4 | 移除文件侧写入，`/api/auth/*` 仅读 DB；OAuthDetail 并入 CredentialForm | git revert |

风险与对策：
- **refreshToken 失效**：迁移后首次使用若 refresh 失败，UI 回退到"重新登录"引导（与现有错误态一致）。
- **多部署环境**：脚本只迁移本机 Pi Runtime 目录；远程部署（192.168.1.14）单独执行。
- **密钥轮换**：tokens 与 UserApiKey 共用 encryption key，轮换策略保持一致。

---

## 五、与 Stage 6 边界的核对

- ✅ 不修改 UserApiKey Schema
- ✅ 不改变 `/api/models` scope、不碰 models.json
- ✅ Credential ownership 进一步收归 ProjectHub（符合最终架构：ProjectHub 掌握凭证/持久化/权限）
- ✅ Pi Runtime 本体不改（仅凭证存储位置变化，Pi Auth Parsing 继续用于 models.json 场景）
