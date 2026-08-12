<!-- reviewer: code-reviewer (硬层) -->

# Code Review: AI Router 重构 — 硬层技术审查

**Scope:** AI Router 重构（前端轻量 Task Router + 后端 detect-intent.ts 权威判断 + model-routing.ts 模型选择）
**Review Type:** Local Changes（git diff）
**Files in scope:** 11 个文件的改动

---

## Code Review Summary

**Verdict: ⚠️ Approved with Critical Fixes Required**

AI Router 重构整体架构清晰，前端轻量提示 + 后端权威判断的职责分离设计合理。类型扩展（image/video）基本到位，路由分支处理正确。

发现 **2 个 Critical**、**3 个 Major**、**2 个 Minor** 问题，必须在合并前修复。

---

## Findings

### Critical (Must Fix)

#### 1. **`runtime-state-bridge.ts:40`** — `PendingHumanActionState.mode` 缺少 `"video"`

```ts
// 当前定义：
mode: "auto" | "search" | "chat" | "web" | "image";
//              ↑ 缺少 "video"
```

`AgentMode`（`state.ts`）已扩展为包含 `"video"`，但 `PendingHumanActionState` 接口的 `mode` 字段未同步。当 video 模式的 runtime state 桥接时，类型强制转换不安全。

- **Impact:** video 模式用户在等待确认（HIL）时，runtime state 持久化到 DB 后再读回，类型不匹配，存在运行时风险。
- **Suggestion:** 将 `mode` 类型改为 `"auto" | "search" | "chat" | "web" | "image" | "video"`。

---

#### 2. **`detect-intent.ts:244` / `task-router.ts:41`** — 图片正则中单独 `画` 会误触发

```ts
// task-router.ts:41
const imageObjectPattern = /(?:图片?|图|画像|照片|封面|海报|画)/i;
//                                                          ↑ 单独一个字 "画"

if (imageVerbPattern.test(trimmed) && imageObjectPattern.test(trimmed)) {
  return { category: "image" };
}
```

当用户输入 "**帮我画画**"（想画一幅画）时：
- `imageVerbPattern` = `/(?:帮我|请)?(?:生成|画|创作|制作)(?:一张|一幅)?/i` → 匹配 `画`
- `imageVerbPattern.test("帮我画画")` = **true**（`"帮我"` 可选匹配，`"画"` 匹配动词）
- `imageObjectPattern.test("帮我画画")` = **true**（匹配 `画`）

→ 结果：误判为 `image` 模式。

同样的问题存在于 `detect-intent.ts:244`：
```ts
/(?:图片?|图|画像|照片)/i.test("画画") // 误触发
```

- **Impact:** 包含"画"字但无图片对象词的纯绘画请求被误分类为 image 模式，绕过正常的 chat 流程。
- **Suggestion:** 将 `imageObjectPattern` 改为 `/(?:图片?|图|画像|照片|封面|海报|一幅画)/i`，要求对象词必须包含至少两个字符，或者单独 `画` 必须配合量词 `一张|一幅` 才算图片意图。

---

### Major

#### 3. **`features/ai/types/modes.ts:12`** vs **`features/ai/routing/task-router.ts:14`** — `AiTaskCategory` 类型重复定义且内容不一致

```ts
// modes.ts:12
export type AiTaskCategory = "auto" | "chat" | "image" | "video";
//                  ↑ 包含 "auto"

// routing/task-router.ts:14
export type AiTaskCategory = "chat" | "image" | "video";
//                  ↑ 不含 "auto"
```

两处都定义了同名的 `AiTaskCategory`，`modes.ts` 包含 `"auto"`，`task-router.ts` 不含。这意味着：
- `model-selector.tsx` 从 `modes.ts` 导入的 `AiTaskCategory` 包含 `auto`
- `task-router.ts` 内部定义的不含 `auto`
- 代码中没有明确的消费错误，但不一致会造成阅读混淆

- **Impact:** 类型定义不一致，IDE 无法追踪哪个定义被谁使用。`modes.ts` 是权威定义处，`routing/task-router.ts` 不应重复定义。
- **Suggestion:** `routing/task-router.ts` 删除本地 `AiTaskCategory` 定义，改从 `@/features/ai/types/modes` 导入，保持单一真相来源。

---

#### 4. **`model-routing.ts:8`** — `capabilities` 参数声明但从未使用

```ts
export function selectModel(
  taskType: TaskType,
  options?: {
    manualOverride?: string;
    defaults?: Partial<Record<TaskType, string>>;
    capabilities?: ModelCapability[];  // ← 声明了
  }
): { providerId: string; modelName: string }
```

`capabilities` 参数被声明但函数体内零引用。按注释意图应该是"按 capabilities 过滤可用模型"，但实际只是走了 defaults 链路。

- **Impact:** 死代码，后续接入 capabilities 过滤时会令人困惑。不影响当前功能但误导维护者。
- **Suggestion:** 删除 `capabilities` 参数，或实现 capabilities 过滤逻辑（查询 registry → 按 capabilities 筛选 → 返回匹配模型）。

---

#### 5. **`detect-intent.ts:250`** — video 意图检测逻辑复杂且可读性差

```ts
const hasVideoIntent = /(?:生成|制作|创作)(?:一个?|段?)?(?:视频?|短片|动画|影片)/i.test(trimmed) ||
  /(?:视频?|短片|动画|影片)[:：]/.test(trimmed) ||
  /(?:帮我|请)?(?:生成|制作)(?:一个?|段?)?/i.test(trimmed) && /(?:视频?|短片|动画|影片)/i.test(trimmed);
//                                                                                              ↑ 第三项用 &&，优先级低于 ||
```

第三项需要用 `&&` 连接两个 `test()`，但 `||` 优先级低于 `&&`，实际等价于 `(A) || (B) || ((C) && D)`——这是正确的，但极易被 future maintainer 误改。

- **Impact:** 可维护性风险，逻辑正确但容易在重构时出错。
- **Suggestion:** 将第三项提取为变量，明确优先级：
```ts
const hasExplicitVideoAction = /(?:帮我|请)?(?:生成|制作)(?:一个?|段?)?/i.test(trimmed);
const hasVideoObject = /(?:视频?|短片|动画|影片)/i.test(trimmed);
const hasVideoIntent = hasExplicitVideoAction && hasVideoObject;
```

---

### Minor

#### 6. **`task-router.ts:61`** — `getTaskHint` 缺少 `auto` 模式的处理

```ts
export function getTaskHint(intent: ResolvedAiIntent): string | undefined {
  if (intent.category === "image") return "image";
  if (intent.category === "video") return "video";
  return undefined;
}
```

当 `intent.category` 为 `"auto"` 时（`modes.ts` 中 `AiTaskCategory` 包含 `"auto"`），`getTaskHint` 返回 `undefined`。虽然语义正确（auto 模式不显示特定 hint），但缺乏显式处理。

- **Impact:** 极低。代码行为正确，但加入 `auto` case 更清晰。
- **Suggestion:** 显式处理 `auto`：`if (intent.category === "auto") return undefined;`

---

#### 7. **`routing.ts:50-51`** — `image`/`video` 分支与 `chat` 共用同一 return

```ts
case "image":
case "video":
case "chat":
default:
  return "generateResponse";
```

`image` 和 `video` 与 `chat`、其他未匹配 mode 共用同一分支。虽在 `detectMode` 中 `image`/`video` 已各自独立分支，但 `routeByMode` 没有独立的 `image`/`video` 分支意味着：如果某处错误传入 `image`/`video`，不会触发类型错误，会静默 fallback 到 `generateResponse`。

- **Impact:** 低。switch 已有 exhaustive check 兜底（TypeScript 4.9+ 配合 `"use strict"`），运行时不会漏，但 switch 缺少独立分支意味着类型安全依赖于 exhaustive check 而非显式分支。
- **Suggestion:** 分离独立分支以提高可读性：
```ts
case "image": return "generateResponse";
case "video": return "generateResponse";
case "chat":
default: return "generateResponse";
```

---

## Positive Points

- **职责分离清晰**：`task-router.ts` 明确标注 `NON-AUTHORITATIVE`，文档注释清楚，detect-intent.ts 确实是唯一权威判断点。
- **模式扩展完整**：AgentMode/AiMode 新增 image/video 已全面覆盖 switch 分支（`routing.ts`、`routeAfterModelSelect`、`routeByMode`）。
- **Agnes 图片生成器**：`generateWithAgnes` 的网络请求包含 AbortController + 120s 超时，数据处理有 b64_json fallback。
- **正则性能**：`task-router.ts` 的正则均使用非贪婪量词（`+?`、`*?`），避免 ReDoS。
- **测试用例覆盖**：18 个测试用例覆盖了主要路径，测试设计合理。
- **tsc 质量门**：除预先存在的 e2e/admin.test.ts 错误外，AI Router 相关文件无新增类型错误。

---

## Type Safety — Switch Exhaustive Check

审查了所有 switch 语句，确认 image/video 分支覆盖情况：

| 文件 | switch 变量 | image 分支 | video 分支 | 评估 |
|------|------------|-----------|-----------|------|
| `routing.ts` | `state.mode` | ✅ 共用 chat/default | ✅ 共用 chat/default | ⚠️ 建议分离 |
| `routeAfterModelSelect` | `mode` | ✅ 独立分支 | ✅ 独立分支 | ✅ |
| `model-routing.ts` | `defaults[taskType]` | ✅ 独立分支 | ✅ 独立分支 | ✅ |
| `detect-intent.ts` | `detectMode` return | ✅ 独立 return | ✅ 独立 return | ✅ |
| `runtime-state-bridge.ts` | `mode` 字段 | ✅ 无 switch | ⚠️ 字段定义缺 video | 已列 Critical |

---

## Security

- **ReDoS**：所有新增正则均为普通 alternation + 非贪婪量词，无嵌套量词，ReDoS 风险低。
- **XSS**：`generate-response.ts` 返回的 `"[IMAGE_MODE]"` 响应是纯文本字符串拼接，无用户输入反射，无 XSS 风险。
- **凭证处理**：`image-generator.ts` 的 `generateWithAgnes` 通过 API key 认证，无额外风险。
- **无敏感信息日志**：所有 console.log 仅记录非敏感元数据（model name、prompt、endpoint），无 API key 泄露。

---

## N+1 / Performance

- **`registry.ts` `inferCapabilities`**（218-233 行）：每次 `discoverModelsFromAPI` 调用时，对每个模型 ID 调用一次 `inferCapabilities`。若一次 discovery 返回 50 个模型，执行 50 次正则匹配。
  - **Impact:** 低。当前只在模型 discovery 时调用（启动/用户添加 Provider 时），不是热路径。
  - **Suggestion:** 可考虑在 `discoverModelsFromAPI` 末尾一次遍历做批处理匹配，但非必须。

---

## Next Steps

1. **必须修复（Critical）**：
   - 修复 `runtime-state-bridge.ts` 添加 `"video"` 到 `mode` 类型
   - 修复图片正则中单独 `画` 字的误触发问题
2. **强烈建议修复（Major）**：
   - 删除 `routing/task-router.ts` 中的重复 `AiTaskCategory` 定义
   - 删除 `model-routing.ts` 中未使用的 `capabilities` 参数（或实现其功能）
   - 重构 video 意图检测的 `&&`/`||` 优先级
3. **可选优化（Minor）**：
   - 分离 `routeByMode` 中的 image/video 独立分支
   - `getTaskHint` 显式处理 `auto` case
