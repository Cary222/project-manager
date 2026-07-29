# Stage 2 软层审查决策清单 — #10144

> 审查产物:`docs/reviews/PR10144-user-search-name-ai-mentor.md`(Verdict: CHANGES_REQUIRED)
> 双审查:`code-reviewer`(硬层) + `ai-mentor`(软层)

## 本 PR 已修(Stage 3 前)

| Fix | 优先级 | 状态 |
|---|---|---|
| `routeAfterHumanConfirmation` 命名歧义 → 加注释 | 中 | ✅ done,routing.ts:66-78 |

## 本轮未修(需告知用户 Stage 5 决策)

### UX Issue 1:多候选消息缺"取消/跳过"说明(优先级:高)

**问题:** `generate-response.ts:207` / `search-structured.ts:512,1079` 三处多候选消息都说"请输入数字或姓名确认",但 `parseUserSelection` 无 cancel 通道。用户选不到自己要的,会被困在循环。

**修法选项(范围从小到大):**

| 方案 | 改动文件 | 承诺 | 复杂度 |
|---|---|---|---|
| A. 仅加文案"输入 0 可取消" | 3 文件文案 | **空头承诺**(parseUserSelection 不支持 0) | 极小(撒谎) |
| B. parseUserSelection 返回 `string \| null \| "skip"` + 加 clear 路径 | human-confirmation.ts + routing.ts + messages/route.ts | 真实可取消 | 中(动状态机) |
| C. 不修,继续提示用户重新发问 | 文案改"如都不匹配,可输入新关键词重新查询" + 路由需要再加一次"清除 pending"的入口 | 仍需扩展 routing | 中(动 routing) |

**Main 倾向:** B 最干净。但本轮不修——routing 状态机扩展属 Stage 4 后的小迭代(5xxx 范围 / human-in-loop 二期)。

**本轮 Stage 5 提交时如要走 B,需要新派 fullstack-developer。**

### `MatchType` 废弃值清理(优先级:低)

**现状:** `features/ai/tools/search-structured.ts:10` `type MatchType = "id" | "name" | "searchName" | "alias" | "fuzzy";` 后两者无对应代码。

**影响范围:** 只 1 行。Stage 3 Smoke 顺手清掉(若不影响其他代码)。

### `test-user-search.ts` 注释误导(优先级:中)

**现状:** 之前修复已加 "靖哥→Jing Zhang 需要 UserAlias 表",但文案仍说"由 Step 5 weak name contains 兜底"。

**影响范围:** 只注释。Stage 3 Smoke 顺手修。

### `pendingConfirmation` 与 `confirmedUserId` 统一(优先级:低)

后续 PR。

### `MatchType` / 回填脚本进度 / `backfill` 二次确认 / 设计决策文档(优先级:低)

后续 PR。

## Stage 5 commit 范围

(沿用既有 dev status + 接线产物 + 本轮 routing 注释)

- M:`features/ai/graph/edges/routing.ts`(注释)
- M:`features/ai/graph/agent.ts`(接线)
- M:`features/ai/graph/edges/routing.ts`(接线,同一文件)
- M:`features/ai/graph/nodes/detect-intent.ts`(接线)
- M:`features/ai/graph/nodes/generate-response.ts`(接线)
- M:`features/ai/graph/nodes/search-structured.ts`(接线)
- M:`features/ai/tools/search-structured.ts`(searchName + dedupe)
- M:`app/api/ai/conversations/[id]/messages/route.ts`(cross-turn pending)
- M:`app/api/register/route.ts`(sync)
- M:`features/admin/settings.ts`(sync)
- A:`features/ai/graph/nodes/human-confirmation.ts`
- A:`scripts/test-human-in-loop.ts`
- A:`scripts/test-user-search.ts`
- A:`scripts/backfill-user-search-names.ts`(已存在)
- A:`shared/lib/user-search.ts`
- M:`prisma/schema.prisma`(searchName)
- M:`shared/ui/icons.tsx`(?)
- M:`features/ai/ui/AiChatPanel.tsx` / `AiMessageBubble.tsx`(?)
- M:`package.json` + `package-lock.json`(pinyin-pro 依赖)

**严禁**(非 commit 范围):
- 所有 plans/*.md、所有 learning/*.md、其它 reviews/*.md
- check-pkm.ts、scripts/diagnose-*.ts、scripts/fix-*.ts、scripts/check-project-refs.ts、scripts/apply-search-name-column.ts
- docs/features/10081-*.md、docs/features/project-document-rag-upload.md
- docs/reviews/PR-git-sync-bugfix-*.md / PRx-human-in-loop-*.md / PR10144-user-search-name-code-reviewer.md / PR10144-user-search-name-ai-mentor.md

## 验收状态

- ✅ Code-reviewer Critical 1-3 + Warning 高 — 已修
- ✅ Mentor Fix 2 (路由命名) — 已注释修
- ⚠️ Mentor Fix 1 (UX skip) — **范围太大,留给用户决策(Stage 5)**
