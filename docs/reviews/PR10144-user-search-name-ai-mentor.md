<!-- reviewer: ai-learning-mentor (软层) -->

# Mentor Review — #10144 searchName + human-in-loop

## Verdict

**CHANGES_REQUIRED**

理由: `routeAfterHumanConfirmation` 的条件逻辑存在设计缺陷(教学价值低 → 中)，且有 1 处 UX 一致性问题(高优先级)需要本 PR 修复;其余 5 项为教学价值提升建议，可在后续 PR 处理。

---

## 教学价值(中 / 低 标注)

### 1. `resolveUser` Step 3 注释设计意图表达清晰 ✅ (教学价值:高)

**文件:** `features/ai/tools/search-structured.ts:142-144`

```ts
// Step 3: searchName contains any allTerms - confidence 0.95
// 将 allTerms 的每个拼音变体拿去查 searchName（allTerms 已含"jing"/"zhang"/"jingguo"等，
// 配合存储的"jing zhang jingzhang"等值，实现中文昵称→拼音名的跨语言匹配）
```

**评价:** 这段注释解释了"为什么能匹配"而不是"怎么写代码"，符合用户关注"取舍逻辑"的学习风格。对新人理解整个 searchName 机制的**核心原理**帮助很大。

---

### 2. `test-user-search.ts` 第 14-18 行注释仍存误解风险 (教学价值:中 → 建议后续修)

**文件:** `scripts/test-user-search.ts:14-18`

```ts
// 不在 Step 3 范围的中文昵称→拼音名映射（如"靖哥"→"Jing Zhang"）
// 走 Step 5:pinyin token 已在 allTerms 里（"靖"→"jing"+"qiao"等变体），
// 命中的是 searchName 里有 "jing"/"zhang" 这类拼音 token 的用户。
```

**问题:** 硬层 code-reviewer 指出 Step 5 对"靖哥"也是 NOT_FOUND（因为 Step 5 只做 `name contains`，不经过 searchName 字段），这段注释的"走 Step 5"说法本身就不准确。正确描述应该是：**"靖哥"超出本 PR 能力范围——Step 5 的 name contains 查原始 name 字段，不是 searchName，"靖哥"无法映射到"Jing Zhang"。**

**建议:** 改为:

```ts
// 注意："靖哥"→"Jing Zhang"这类中文昵称→英文名映射不在本 PR 范围。
// 原因：Step 5 name contains 查的是 User.name 原始字段（"Jing Zhang"），
// 不是 searchName 拼音字段（"jing zhang"）。"靖哥"两个字不会被 pinyin-pro
// 解析为 "jing"，因此无法命中"jing zhang"。
// 如需支持昵称映射，需要 UserAlias 表（后续 PR）。
```

---

### 3. 缺少设计决策文档（searchName vs search vector） (教学价值:中 → 建议后续补充)

**当前状态:** PR 中没有任何地方说明"为什么选 searchName 冗余存储而不是 embedding/search vector"。

**对学习者价值:** 这个取舍其实很有教育意义：
- **searchName 方案**：规则驱动（拼音规则已知）、行为完全可预测、实现简单、pinyin 完全可控
- **embedding 方案**：语义理解更强、但 pinyin 不可控、行为黑盒、需要额外的 embedding 计算

**建议:** 在 `docs/features/` 或 `scripts/backfill-user-search-names.ts` 头部加一段简短决策说明（3-5 句），让后人知道这个选择的 trade-off。

---

### 4. `backfill` 脚本头部缺少关键上下文 (教学价值:低)

**文件:** `scripts/backfill-user-search-names.ts:1-15`

**缺失信息:**
- 19 个用户实际规模（说明为什么不需要 --limit / --skip 等细粒度参数）
- pinyin-pro 是**运行时**依赖（强调 searchName 是后端字段，非前端搜索用）
- 为什么不增量回填（因为 User.name 改动已有同步逻辑）

**建议:** 头部注释加 2-3 句话即可，不需要过度文档化。

---

## UX 一致性(高 标注)

### 1. 多候选消息措辞不一致（优先级:高 → 本 PR 修复）

**发现三处措辞:**

| 位置 | 消息 |
|------|------|
| `generate-response.ts:207` | `请输入数字或姓名确认。` |
| `search-structured.ts:510` | `请输入数字或姓名确认。` ✅ 一致 |
| `search-structured.ts:1077` | `请输入数字或姓名确认。` ✅ 一致 |
| `human-confirmation.ts` | `parseUserSelection` 支持"跳过"(return null)，但没有消息告诉用户可以跳过 |

**实际问题:** 消息措辞已一致，但**缺少"跳过"选项的说明**。`parseUserSelection` 返回 null 时，`generateResponseNode` 会重新渲染相同的多候选消息（因为 `waitingForConfirmation` 保持 true）。用户如果不知道可以输入数字或名字，可能会困惑为什么 AI 在重复同一个问题。

**建议:** 在多候选消息末尾加一句: `输入 0 可取消并重新提问。` 或类似的"取消"说明。

---

### 2. 确认消息与 API SSE 跨轮次 `pendingConfirmation` 状态同步路径隐蔽 (优先级:中)

**文件:** `features/ai/graph/nodes/search-structured.ts:92-106` + `features/ai/graph/edges/routing.ts:60-62`

**问题描述:** 新人看 `searchStructuredNode` 会发现 `pendingConfirmation` 被设置，但不知道这个状态怎么传递给前端并在下一次请求中恢复。答案是：`routing.ts:60-62` 的 `routeAfterDetectIntent` 检查了 `state.pendingConfirmation && state.waitingForConfirmation`，触发 `humanConfirmation` 节点——但这条路径没有注释说明"pending 状态是通过 LangGraph state 在 nodes 之间传递的"。

**建议:** 在 `agent.ts` 的 graph 流程图注释里加一行: `pendingConfirmation + waitingForConfirmation 通过 LangGraph State 跨 nodes 传递，humanConfirmationNode 负责消费和清空`。

---

## 命名可读性

### 1. `MatchType` 包含废弃值 `"fuzzy"` 和 `"alias"`（优先级:低 → 建议后续清理）

**文件:** `features/ai/tools/search-structured.ts:10`

```ts
type MatchType = "id" | "name" | "searchName" | "alias" | "fuzzy";
```

**问题:** `alias` 和 `fuzzy` 在 `resolveUser` 里没有实际返回（对应的 Step 4/5/6 代码被注释掉）。新人读代码时会疑惑"fuzzy 是什么、为什么有但不用"。`MatchType` 的语义是"匹配来源"（id / name / searchName），而 `alias` 和 `fuzzy` 是语义概念，不是来源。

**建议:** 把废弃值移到注释里或删除，减少初学者困惑:

```ts
type MatchType = "id" | "name" | "searchName";
// "alias" and "fuzzy" reserved for future UserAlias table (see Step 4/5 comments)
```

---

### 2. `confirmedUserId` vs `pendingConfirmation` 在 `searchStructuredNode` 中的职责边界清晰 ✅ (命名可读性:好)

**文件:** `features/ai/graph/nodes/search-structured.ts:48-71`

**评价:** `confirmedUserId` 作为"用户已确认的选择"，语义清晰。和 `pendingConfirmation.candidates` 共存的设计虽然有点绕（硬层 code-reviewer 也提到了），但代码本身有注释说明用途:

```ts
// Check if user confirmed a selection from previous pending confirmation
const confirmedUserId = state.toolResults?.confirmedUserId as string | undefined;
```

命名本身没问题，问题在于状态设计（见下节）。

---

## 状态机设计

### 1. `routeAfterHumanConfirmation` 条件逻辑存在教学歧义（优先级:中 → 本 PR 修复）

**文件:** `features/ai/graph/edges/routing.ts:70-74`

```ts
export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.waitingForConfirmation) {  // ← 名称暗示"等待中才进这里"
    return "generateResponse";
  }
  return "searchStructured";
}
```

**歧义所在:** `waitingForConfirmation` 字面意思是"正在等待确认"，直觉上应该是"true → 继续等待 → 下次轮询"。但实际逻辑是 **反的**：`true → generateResponse`（重新渲染提示），`false → searchStructured`（执行搜索）。

这个矛盾是因为 `waitingForConfirmation` 的真实语义是 **"最近一轮生成是否在等待确认"**——不是"当前是否应该等待"，而是"最近一轮 AI 的输出是否是确认提示"。所以：
- `true` = AI 刚发了确认消息，现在进 generateResponse 重新渲染
- `false` = 用户已选，AI 不需要再发确认，直接搜

**教学价值:** 对新人来说，这个命名很容易造成误解，建议改名为 `wasWaitingForConfirmation` 或 `needsReconfirm`，语义更清晰。

**建议:** 改名为 `needsReconfirm` 并加注释:

```ts
/**
 * Route after human confirmation.
 * needsReconfirm = true: user just sent an invalid input (e.g., "不知道") →
 *   re-render the confirmation prompt via generateResponse.
 * needsReconfirm = false: user made a valid selection →
 *   proceed to searchStructured with the selected userId.
 */
export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.needsReconfirm) {
    return "generateResponse";
  }
  return "searchStructured";
}
```

---

### 2. `pendingConfirmation` 的作用域限定清晰，但和 `confirmedUserId` 存在职责重叠（优先级:低）

**文件:** `features/ai/graph/agent.ts:76-79`

**当前状态:** `pendingConfirmation` 仅用于 `user_disambiguation` 场景（有多个候选用户）。`confirmedUserId` 是另一种"选择"——用户确认后记录在 `toolResults` 里供 `searchStructuredNode` 直接使用。

**问题:** `confirmedUserId` 走的是 `toolResults` 路径，`pendingConfirmation` 走的是 `pendingConfirmation` 路径。两套机制并存但语义相近（都是"用户做了一个选择"），对新人来说需要理解两套东西。

**建议（后续 PR）:** 可以把 `confirmedUserId` 也纳入 `pendingConfirmation`，统一为一个结构:
```ts
interface PendingConfirmation {
  type: "user_disambiguation";
  candidates: UserCandidate[];
  query: string;
  selectedId?: string; // ← 用户确认后写入这里
}
```

---

## 设计取舍

### 1. searchName 冗余存储 vs search vector 的取舍有充分理由 ✅（教学价值:好）

**文件:** `prisma/schema.prisma:14` + `shared/lib/user-search.ts:12`

**评价:** Schema 注释 `"冗余存储避免运行时计算"` 虽然简短，但点出了核心 trade-off。结合 `buildUserSearchTerms` 的规则逻辑，用户可以理解：
- **searchName 方案**：规则驱动、行为完全可预测（contains 精确控制）、pinyin 可控、实现简单
- **search vector**：语义理解更强、但 embedding 行为黑盒、需要额外服务

**唯一建议:** 注释可以加一句说明 searchName 的能力上限：`// 不支持语义相似匹配（如"张靖"和"靖哥"），仅支持规则化拼音/文字模糊匹配`

---

### 2. `chineseToPinyin` 两处实现的取舍（教学价值:低）

**文件:** `shared/lib/user-search.ts:19-31` + `features/ai/tools/search-structured.ts:79-99`

硬层已标记重复实现。**从软层角度**，两处共存的取舍逻辑是：
- `shared/lib/user-search.ts`：回填脚本用（在 tsx 脚本环境里直接调 pinyin-pro）
- `search-structured.ts` 里：AI tool 在 Vercel AI SDK / LangChain 环境里调

硬层建议统一引用 `shared/lib`，执行后两处变成一个 source of truth。这是正确的方向。

---

## 回填策略评估

### 1. `backfill` 脚本幂等性设计合理 ✅（教学价值:中）

**文件:** `scripts/backfill-user-search-names.ts:24-70`

**优点:**
- `--dry-run` 模式完整，支持预览后执行 ✅
- 分批处理（100 条/批），生产友好 ✅
- 幂等（重复跑直接 overwrite）✅
- 错误计数 + 退出码（errors > 0 → exit 1）✅

**不足（教学价值:低 → 建议后续补）:**

1. **无进度百分比**: 19 个用户跑 1 批无所谓，但注释写了"分批处理"意味着为扩量留了口子。如果未来几千用户，没有百分比进度会让运维者不知道跑了多少。

2. **实跑无二次确认**: `DRY_RUN` 模式下没有交互确认，用户直接跑 `npx tsx scripts/backfill-user-search-names.ts` 会直接写库。虽然幂等，但如果脚本逻辑有 bug，后果不可逆。

   建议加一行判断：非 dry-run 且用户数 > 100 时提示确认。

3. **没有 --limit 参数**: 生产扩量后如果只想测 10 条用户，需要临时改脚本。不算大问题，但可以留个口子。

---

## Positive Points

- ✅ `human-confirmation.ts` 的 `parseUserSelection` 三个策略（数字精确 → 名字精确 → 部分匹配）逻辑清晰，注释说明"支持的输入形态"，教学价值高
- ✅ `searchStructuredNode` 的 `extractUserIdentifier` 完整覆盖了中英文混合输入的提取逻辑（`features/ai/graph/nodes/search-structured.ts:130-196`），注释丰富
- ✅ `backfill` 脚本支持 `--dry-run`，幂等设计合理
- ✅ `generateResponseNode` 的 human-in-loop 分支（`features/ai/graph/nodes/generate-response.ts:200-218`）逻辑清晰，与正常流程分离良好
- ✅ 多候选消息措辞在三处已保持一致（`generate-response.ts:207` / `search-structured.ts:510` / `search-structured.ts:1077`）
- ✅ `agent.ts` 的 graph 流程图注释（`features/ai/graph/agent.ts:100-110`）对理解 LangGraph 状态流转帮助很大
- ✅ Step 编号注释（`// Step 1: Exact id match` → `// Step 3: searchName contains`）对新人理解 resolveUser 的分层降级策略非常直观

---

## Next Steps

**本 PR 需要修复（软层 must-fix）:**

1. **[高] 确认消息加"跳过/取消"说明** — 在 `generate-response.ts:207` 和 `search-structured.ts:510,1077` 的多候选消息末尾加"输入 0 可跳过"。
2. **[中] `routeAfterHumanConfirmation` 命名歧义** — 改名为 `needsReconfirm` 或加注释说明 `waitingForConfirmation` 的真实语义。

**后续 PR 建议（软层 should-fix）:**

1. **[中] `test-user-search.ts:14-18` 注释改为准确描述**：明确说明"靖哥"→"Jing Zhang"是 NOT_FOUND，原因是 Step 5 name contains 不经过 searchName。
2. **[中] 补充设计决策文档**：在 `backfill` 脚本头部加 3-5 句说明 searchName vs search vector 的取舍理由。
3. **[低] `MatchType` 废弃值清理**：删除或注释掉未使用的 `"alias"` 和 `"fuzzy"` 值。
4. **[低] `backfill` 进度百分比 + 二次确认**：用户数 > 100 时提示确认。
5. **[低] `pendingConfirmation` 与 `confirmedUserId` 统一**：将 `confirmedUserId` 纳入 `pendingConfirmation.selectedId`，减少两套机制的认知负担。
