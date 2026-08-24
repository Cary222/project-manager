# Stage 7 评估：PiSubAgent → ModelRuntimeConfig 适配 / ProjectHub Config → Pi Adapter 单向下发

**日期**: 2026-08-21（2026-08-22 更新：方案 C 已实施）
**状态**: 方案 C 已落地（`features/ai/llm/pi-session-config.ts` + PiSdkRuntime 接入，6 个单测覆盖）

---

## 一、现状盘点

| 组件 | 模型配置来源 | 说明 |
|------|-------------|------|
| Chat / WorkAgent（User Scope） | `/api/ai/models` + `UserAiModelPreference` | Stage 6 已统一到 `resolveModelRuntimeConfig` |
| Pi Workspace UI（配置视图） | `models.json` ∪ 站点继承视图 | Stage 7 继承链路：load 合并、save 仅写 workspace、discover/test DB 凭证回落 |
| Pi Workspace 运行时 / `/api/models` | 仅 `models.json`（Pi ModelRuntime） | 未合并站点配置 |
| PiSubAgent（`features/ai/agents/work/subagents/pi/`） | PiSdkRuntime → `models.json` | 独立 Coding Agent Runtime，机器级配置 |

核心矛盾：**`models.json` 是机器级（machine-global）配置，而站点凭证/偏好是用户级（per-user）**。
这是所有方案的第一约束。

---

## 二、候选方案

### 方案 A：仅语义映射（最小改动）
- 在 PiSubAgent 启动时调用 `resolveVisibleModels` + `selectInitialModelScope`，
  再经 `toRuntimeConfigShape()` 映射为 `ModelRuntimeConfig` 形状（只读，供日志/策略网关/回显）。
- 运行时本体仍用 Pi SDK 自己的模型对象。
- 优点：零风险、不改存储；缺点：用户级偏好（thinkingLevel/temperature）不生效于 PiSubAgent。

### 方案 B：全局 models.json 物化（不推荐）
- 保存站点配置时把 DB 凭证/模型物化写入全局 `models.json`。
- **致命问题**：多用户共享部署时，A 用户的 key 会被物化进机器级文件，B 用户的
  PiSubAgent 会话将看到/使用 A 的凭证 → 凭证越权。同时违反"不建立 DB ↔ models.json
  双向 SoT"的约束精神（这是 DB → 文件的单向写，但文件又被 Pi 手动编辑，冲突不可控）。
- 结论：否决。

### 方案 C：会话级临时 models.json（推荐）
- PiSubAgent 每次启动会话时，服务端合成 **临时 models.json**（mkdtemp，会话结束清理）：
  `站点配置（该用户的 USER + SYSTEM 凭证解密后的 provider 段） ∪ workspace models.json（覆盖优先）`。
- 技术先例已存在：`lib/model-discovery-auth.ts`（临时 models.json + Pi ModelRuntime.getAuth）
  与 `lib/model-connection-test.ts`（临时 models.json + completeSimple）——模式成熟、阅后即焚。
- PiSubAgent Runtime 本体不改，只是 `ModelRuntime.create({ modelsPath })` 指向临时文件。
- thinkingLevel / reasoning 偏好：临时文件中写入模型的 `thinkingLevelMap` / `reasoning`
  （来自 UserAiModelPreference），Pi Runtime 原生支持这两个字段 → 用户偏好自然生效。
- 优点：用户隔离、凭证不落盘（相对全局文件）、不污染用户手动维护的 models.json、可回滚（开关）。
- 成本：每会话一次文件合成（毫秒级，已有同模式先例）；需要 PiSubAgent 启动入参带 userId（现有 `SubAgentInput.userId` 已具备）。

### 决策矩阵

| 维度 | A 语义映射 | B 全局物化 | C 会话级临时文件 |
|------|-----------|-----------|------------------|
| 用户凭证隔离 | ✅ | ❌ 越权风险 | ✅ |
| 用户偏好生效 | ❌ | ✅ | ✅ |
| 改动面 | 极小 | 大（存储+冲突处理） | 中（启动链路） |
| 回滚 | 天然 | 困难 | 开关即回滚 |
| 符合既有约束 | ✅ | ❌ | ✅ |

**建议：A 先行（本 Stage 收尾可做），C 作为 Stage 8 实施目标；B 否决。**

> ✅ **2026-08-22 实施记录（方案 C）**：
> - `synthesizeSessionModelsConfig(userId)`：workspace 优先 + 站点模型补充 + thinkingLevel 注入；
>   临时文件不落任何密钥（凭证继续由 setRuntimeApiKey 注入，比原方案更严）。
> - PiSdkRuntime：ModelRuntime.create 使用合成 modelsPath；合成失败自动回落默认行为；
>   临时目录在完成/中止时幂等清理。
> - 安全：临时目录 0700 / 文件 0600；单测断言合成内容不含站点密钥。

---

## 三、方案 C 的实施切面（Stage 8 预研）

1. `features/ai/llm/pi-session-config.ts`（新）：
   `synthesizeSessionModelsJson(userId): Promise<string /* tempPath */>`
   - 读 workspace models.json（`readModelsConfig`）
   - 读 `getSystemCredentials()` + `getUserProviderRecords/resolveCredential(userId, *)`
   - 合并规则：workspace 段优先；站点段补 `baseUrl/api/apiKey/models`；
     UserAiModelPreference 的 thinkingLevel → 模型 `thinkingLevelMap`（仅支持的 level 集合）
   - 写临时目录（权限 0700），返回路径 + `cleanup()`
2. PiSubAgent `PiSdkRuntime` 启动参数接入 `modelsPath`（transport 已有 sdkOptions，扩一个字段）。
3. `/api/models`（Workspace Scope）**保持不变**；可选新增 `/api/models?merged=1` 供 UI 预览合并视图（只读）。
4. 回归门槛：PiSubAgent 用纯 workspace 配置跑通既有 e2e；再开 merged 模式跑同一 e2e。

---

## 四、与已完成工作的衔接

- Stage 7 继承链路（UI 视图合并 + discover/test DB 回落）已验证"单向继承、凭证不出库"模式可行；
  方案 C 是同一模式在**运行时**的延伸，方向一致。
- `resolveModelRuntimeConfig` / `availableReasoningLevels` / `buildReasoningProviderOptions`
  对 PiSubAgent 无直接依赖（Pi Runtime 用自己的 thinking 机制），但 `toRuntimeConfigShape`
  映射可用于 WorkAgent 策略网关统一回显。
