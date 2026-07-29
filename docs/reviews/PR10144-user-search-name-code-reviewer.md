<!-- reviewer: code-reviewer (硬层) -->

# Code Review — #10144 searchName 改造

## Verdict

**CHANGES_REQUIRED**

理由: 重复接口定义(`ExtractedUser`)和一个必须修的回归路径(`resolveUser` 接受 `ExtractedUser` 但 `listCandidateUsers` 仍用旧 `string`),会让 searchName 模糊匹配在本 PR 之外的地方失效;另外 `search-structured.ts` 残留 4 个 `console.log` 调试日志需在合并前清除。其余 6 项提示可后续 PR 处理。

---

## Critical (Must Fix)

### 1. 类型回归 — `listCandidateUsers` 签名未升级,依旧接受 `string`,搜索字段未被覆盖

**文件:** `features/ai/tools/search-structured.ts:267-286`
**问题:** 本 PR 把 `resolveUser` 的入参从 `string` 升级为 `ExtractedUser`(raw + normalized),并配套了 searchName contains 逻辑。但同一文件里的 `listCandidateUsers` 仍保留 `identifier: string` 形参,内部 `where: { OR: [{ name: { contains: ... } }, { email: { contains: ... } }, { id: { contains: ... } }] }` 完全没引入 `searchName` 字段。
**Impact:** LLM 调用 list_user_candidates / disambiguate 这类路径时,搜索**绕过了** searchName 字段,本次 PR 投入的回填 + 改字段收益会打折扣。
**Suggestion:** 将 `listCandidateUsers` 改造为接受 `ExtractedUser`,在 OR 分支里补 `{ searchName: { contains: identifier.normalized, mode: "insensitive" } }`;

```typescript
async function listCandidateUsers(identifier: ExtractedUser): Promise<string> {
  const users = await prisma.user.findMany({
    where: {
      bannedAt: null,
      OR: [
        { name: { contains: identifier.normalized, mode: "insensitive" } },
        { email: { contains: identifier.normalized, mode: "insensitive" } },
        { id: { contains: identifier.raw } },
        { searchName: { contains: identifier.normalized, mode: "insensitive" } },
      ],
    },
    take: 20,
    select: { id: true, name: true, email: true, role: true },
  });
  // ...
}
```

---

### 2. 重复类型定义 — `ExtractedUser` 在 51 行和 67 行出现两次

**文件:** `features/ai/tools/search-structured.ts:51-54, 67-70`
**问题:** `export interface ExtractedUser { raw: string; normalized: string; }` 出现两次,中间夹了 `setSearchStructuredViewer` 函数定义。这会让 TypeScript 在多次 export 同一 type 时给出 "Duplicate identifier" 报错风险(若编辑器走 strict mode,光 lint 都会标红),也可能让后续维护者不知道哪个才是 source of truth。
**Impact:** 让人困惑、不符合 DRY;若后续一边加了字段另一边没加,运行时 silent failure。
**Suggestion:** 删除 67-70 行的重复定义,保留 51-54 行作为唯一声明。或者把 `ExtractedUser` 提到 `shared/lib/user-search.ts` 一并 export,搜索侧 import 复用,语义更清晰。

---

### 3. 调试日志残留 — `console.log` 在 resolveUser 出现 4 处

**文件:** `features/ai/tools/search-structured.ts:151, 211, 220`
**问题:** `console.log("[resolveUser] searchTerms=...")`、`console.log("[resolveUser] term=... matches=...")`、`console.log("[resolveUser] allCandidates=...")` 共 3 处显式日志(还有第 179 行的 searchName 命中分支未显式打印但匹配机制完整时也建议去掉)。本 PR 新增的 resolveUser 路径如果每次 AI chat 都被命中,会在生产日志刷大量 JSON。
**Impact:** log noise,且会把所有用户 searchName 输入拼成的 term 列表写进日志,轻微 PII 风险(email 不会经过这里但 name 会)。
**Suggestion:** 全部移除,或降级为 `console.debug`/`debug(...)` 由日志级别控制。`docs/reviews/PR-git-sync-bugfix-code-reviewer.md` 已记录 scan.ts 调试日志问题,这是同类反模式。

---

## Warning (Should Fix)

### 4. 数据一致性 — `prisma.user.update` 还有 4 处不重算 searchName

**文件:** `features/admin/admin.ts:119, 155, 187` 与 `prisma/promote-admin.ts:41`
**问题:** `Grep` 全工作区 `prisma.user.update` 共 7 处命中,其中 #10144 只改了 `features/admin/settings.ts:99` (rename) 和 `app/api/register/route.ts:27` (create) 两处。
- `features/admin/admin.ts:119` — `updateUserRoleAction` 只改 `role`,不影响 name,✅ 安全
- `features/admin/admin.ts:155` — `banUserAction` 只改 `bannedAt`,✅ 安全
- `features/admin/admin.ts:187` — `unbanUserAction` 只改 `bannedAt: null`,✅ 安全
- `prisma/promote-admin.ts:41` — `promote-admin.ts` 只改 `role`,✅ 安全

**结论:** 现有 4 处 update 都不动 name 字段,无需补充 searchName 同步。但需要在交付报告里写明 grep 验证结果(避免未来 PR 误增"name 修改路径")。
**Action:** 在 `docs/features/` 复现文档写"grep 验证清单",列明所有 update 路径的字段,提示后人扩展 name 修改时记得同步 searchName。

---

### 5. 性能 — `Step 3` 和 `Step 5` 的 N+1 查询未被合并

**文件:** `features/ai/tools/search-structured.ts:172-179, 205-217`
**问题:**
- Step 3 对 `uniqueTerms` 每个 term 单独发一次 `prisma.user.findFirst({ where: { searchName: { contains: term } } })`,N 个 term = N 次 query(虽然有 confidence 0.95 短路,首次命中即返回,但最差情况会跑 N 次)
- Step 5 弱匹配对 each `allTerms` 都发 `findMany({ name: { contains: term } })`,无论是否已找到候选都会跑全 N 次

**Impact:** 用户量 19 个时期望运行良好,但用户量扩到几百/几千时,每次 resolveUser 会触发 5-10 次 SQL round-trip,AI chat 每次 query 走 resolveUser 就会变成 5-10x 慢。
**Suggestion:** 合并为单次 OR 查询:

```typescript
// Step 3 合并
if (uniqueTerms.length > 0) {
  const bySearchName = await prisma.user.findFirst({
    where: {
      searchName: { contains: uniqueTerms[0], mode: "insensitive" },
      bannedAt: null,
      OR: uniqueTerms.slice(1).map((t) => ({ searchName: { contains: t, mode: "insensitive" } })),
    },
    select: { id: true, name: true },
  });
  // ...
}
```

**Note:** 用户量 19 个时不算 must-fix,但 Step 5 弱匹配那段对每个 term 都跑一次 findMany 是会被频繁触发的(因为 confidence 0.5 不短路),建议至少在 Step 5 加 early-exit: `if (candidates.size >= 5) break` 防止过度放大。

---

### 6. 索引 — `searchName` 字段未加索引,后续扩量会全表扫描

**文件:** `prisma/schema.prisma:14`
**问题:** `searchName String?` 注释说"冗余存储避免运行时计算",但配合 `mode: "insensitive"` + `contains` 在 PostgreSQL 上是大小写不敏感的全表扫描,用户量 19 个无影响,扩到几百 × 几千行就需要索引。
**Impact:** 性能风险是延迟的,当前可接受,但应该在 schema 注释里写明"待用户量扩到 > 100 时加 GIN trigram index"。
**Suggestion:** 在 `prisma/schema.prisma` 加一行注释:

```prisma
searchName String? // 所有变体空格分隔，冗余存储避免运行时计算
               // ⚠️ 用户量超 100 时需添加 @@index([searchName]) + pg_trgm GIN 索引
```

`cross-mentor:` 教学价值判断(是否值得本 PR 同步加索引)交 mentor 评估。

---

### 7. 测试用例 — `test-user-search.ts` 注释误导 + 缺中文昵称→英文名端到端

**文件:** `scripts/test-user-search.ts:14-15`
**问题:** 注释写"中文→拼音名映射(靖哥→Jing Zhang)由 Step 5 weak name contains 兜底",但实际 `resolveUser` 的 Step 5 并未做"靖哥"→"Jing Zhang"这种跨语种 token 匹配 —— Step 5 只查 `name contains: term`,只会在 searchName 里有"jing"字符时命中,而非"靖哥"两个字匹配到拼音 "Jing"。
**Impact:** 注释会让维护者误以为"靖哥"输入能搜到 Jing Zhang,实际不会。
**Suggestion:**
1. 修正注释,改为"中文昵称→拼音名映射不在本 PR 范围,Step 5 weak name contains 只能命中 searchName 含有 'jing'/'zhang' 等拼音 token 的用户"
2. 补一个测试用例: `'输入 "靖哥" → 期望 NOT_FOUND (本 PR 暂不支持)'` 锁住这个边界

另: `test-user-search.ts:55` 的 `if (result && result.name === tc.expectName)` 比较严格,期望匹配存储的 `name` 字段而非 `searchName`。如果未来某次重构让 `searchName` 重新计算(比如 `name` 改了),回填时 `name` 不会同步,测试会假阳性失败。建议加 `result.searchName` 打印到失败信息里,便于排错。

---

### 8. 代码重复 — `chineseToPinyin` 在 `shared/lib/user-search.ts` 和 `search-structured.ts` 各实现一份

**文件:** `shared/lib/user-search.ts:19-31` 与 `features/ai/tools/search-structured.ts:79-99`
**问题:** 两处 `chineseToPinyin` 函数几乎相同(都调 `pinyin(..., { toneType: "none", type: "string", nonZh: "removed", surname: "head" })`),区别仅在于 import 名 (`pinyin` vs `pinyin as pinyinPro`)。
**Impact:** 两处实现漂移风险。回填脚本写完 searchName,如果 resolveUser 的 `chineseToPinyin` 选项改了,会查不到自己刚刚写进去的值。BACKFILL 后用户搜索"靖"找不到 user,极易出 bug。
**Suggestion:** 在 `shared/lib/user-search.ts` 把 `chineseToPinyin` 也 export,`search-structured.ts` 删除本地实现,改 import 复用:

```typescript
// features/ai/tools/search-structured.ts
import { buildUserSearchTerms, chineseToPinyin } from "@/shared/lib/user-search";
```

这样 Pinyin 变体生成是单一 source of truth,回填和查询共用,漂移不了。

---

### 9. `pinyin as pinyinPro` 的 rename 是 mask 命名冲突而非优雅解

**文件:** `features/ai/tools/search-structured.ts:76`
**问题:** `import { pinyin as pinyinPro } from "pinyin-pro"` —— rename 只因为 shared/lib 里也用了 `pinyin`。本质是用 as 起别名绕开命名冲突。
**Suggestion:** 复用 `chineseToPinyin` 之后,本 import 根本不需要(只在 charPinyins 那一处用 `pinyinPro(normTrimmed, { type: "array" })` 取拆字拼音),可以改为单独 import:

```typescript
import { pinyin as pinyinArray } from "pinyin-pro";
```

或者抽出 `getCharPinyins()` 函数放进 `shared/lib/user-search.ts`,search-structured 只复用,不再 import pinyin-pro。

---

### 10. 测试脚本缺 — `apply-search-name-column.ts` 临时绕过 prisma db push 的根因没记录

**文件:** `scripts/apply-search-name-column.ts`
**问题:** 这是绕过 `prisma db push` 冲突直接 SQL 加列的临时脚本,本 PR 注释只说"绕过 UploadedFile 迁移冲突",但 `UploadedFile` 表的迁移冲突**根因**没记,以下一次遇到同样问题的人会再次 30 分钟 debug。
**Suggestion:** 在 `scripts/apply-search-name-column.ts` 头部加注释:

```typescript
/**
 * 临时脚本: 通过 SQL 直接添加 User.searchName 列
 * 根因: prisma/schema.prisma 之前在 UploadedFile 表做了几次修复,
 *      db push 与当前 schema 状态不一致导致 migrate diff 冲突。
 * 直接 SQL 加列是 workaround,真正的 prisma migration 文件未生成。
 * 待 prisma migrate 重新对齐后,本脚本应删除。
 *
 * 一次性执行,idempotent(列存在会跳过)。
 */
```

---

## Suggestion (Optional)

### 11. `searchName` 字段命名 — 考虑显式声明长度上限

**文件:** `prisma/schema.prisma:14`
**Suggestion:** 用 `String? @db.VarChar(200)` 明确上限,防止 `buildUserSearchTerms` 未来增加变体时单行超大;当前 19 个用户没影响,但 schema 字段是契约层。

### 12. `pinyin-pro` 包 — 体积影响

**文件:** `package.json:50`
**Suggestion:** `pinyin-pro` 是 80KB+ 的运行时依赖,只用于人名搜索;若后续 vite/edge runtime 体积敏感,考虑 server-side 计算 searchName 后端做,前端只 import `buildUserSearchTerms`(已经是这样)。OK 不动。

### 13. `resolveUser` 的 candidates mode 排序按 matchScore 但 fallback 路径不计入

**文件:** `features/ai/tools/search-structured.ts:225-228`
**Suggestion:** `candidates.sort((a, b) => b.matchScore - a.matchScore)` 只基于 path A(weak name contains)的 score;若 Step 3 searchName 命中后用户取消,后续 Step 5 候选不与历史 score 合并。建议为 candidates 加一个 `sources: ("searchName" | "name" | "email")[]` 字段,LLM 在 disambiguate 时可看到命中来源,提升决策质量。`cross-mentor:` UX 取舍。

---

## 测试覆盖

### 通过 ✅

- `scripts/test-user-search.ts` 覆盖 7 个正向用例 (`"jing"`, `"min"`, `"xu min"`, `"maidy"`, `"abb"`, `"zzz"`, `"cary"`),所有 searchName contains 路径都被覆盖
- `scripts/backfill-user-search-names.ts` 支持 `--dry-run`,且成功/失败计数
- 自动化测试触达了 searchName 写入(`register` + `updateProfile`)和读取(`resolveUser` Step 3)两端

### 缺失 ⛔

- **中文昵称→英文名 end-to-end:** `"靖哥"` / `"maidy姐"` 等本地化昵称能否命中"Jing Zhang" / "maidy" — `test-user-search.ts` 没断言,需在 `inverse-mode` 或 `mock-extractedUser` 模式下补
- **null / 纯标点 name:** `buildUserSearchTerms(null)` / `buildUserSearchTerms("!!!")` 还没单测
- **Unicode 边界:** `buildUserSearchTerms("name with é")` 等带变音符号输入
- **小写化顺序:** `"Jing ZHANG"` vs `"jing zhang"` 是否被 `mode: "insensitive"` 全文搜索同等处理(测试只 compar `name`,实际是 searchName 字段匹配)
- **id-only 路径:** `resolveUser({ raw: "cklxxx", normalized: "cklxxx" })` 是否走 Step 1 命中(测过 `byId`,但 resolveUser 接受 `ExtractedUser` 是新形态,接口测试未补)
- **vitest 单元测试:** `shared/lib/user-search.ts` 这种纯函数最适合 vitest 单测,目前只有 `scripts/test-user-search.ts` 集成测试,慢且依赖 DB

---

## git commit 范围建议

### 本次 commit 必须包含 (`A`/`M`)

```
A  shared/lib/user-search.ts
A  scripts/backfill-user-search-names.ts
A  scripts/test-user-search.ts
M  prisma/schema.prisma
M  features/ai/tools/search-structured.ts
M  app/api/register/route.ts
M  features/admin/settings.ts
M  package.json
M  package-lock.json
```

`package.json` / `package-lock.json` 的 `pinyin-pro` 新增依赖是本次 PR 引入(已确认),不属于无关改动,但应单独一行 commit message 说明为何引入(因为 pinyin-pro 也用于 `shared/lib/user-search.ts`,不只是 search-structured.ts)。

### NOT in this commit (必须排除)

```
??  scripts/apply-search-name-column.ts                  ← 临时绕过脚本,建议删除
                                                            (无依赖,已上线后无价值)
??  features/ai/graph/nodes/human-confirmation.ts         ← 无关改动
??  features/ai/graph/agent.ts                           ← 无关改动
??  features/ai/graph/edges/routing.ts                   ← 无关改动
??  features/ai/graph/nodes/detect-intent.ts              ← 无关改动
??  features/ai/graph/nodes/generate-response.ts          ← 无关改动
??  features/ai/ui/AiChatPanel.tsx                       ← 无关改动
??  features/ai/ui/AiMessageBubble.tsx                   ← 无关改动
??  shared/ui/icons.tsx                                  ← 无关改动
??  app/api/ai/conversations/[id]/messages/route.ts      ← 无关改动
??  scripts/check-pkm.ts                                 ← 无关改动
??  scripts/check-project-refs.ts                        ← 无关改动
??  scripts/diagnose-document-failed.ts                  ← 无关改动
??  scripts/diagnose-document-search.ts                  ← 无关改动
??  scripts/fix-note-tags.ts                             ← 无关改动
??  .cursor/plans/ai中转平台服务运维_*.plan.md           ← 无关改动
??  .cursor/plans/ai中转平台长期建设_*.plan.md           ← 无关改动
??  .cursor/plans/user-semantic-search-fix_*.plan.md     ← 无关改动
??  docs/features/10081-project-detail-rag-recap.md      ← 无关改动
??  docs/features/project-document-rag-upload.md         ← 无关改动
??  docs/learning/LangGraph-Architecture-Roadmap.md      ← 无关改动
??  docs/learning/LangGraph-实战学习计划.md              ← 无关改动
??  docs/reviews/PR-git-sync-bugfix-ai-mentor.md         ← 无关改动
??  docs/reviews/PR-git-sync-bugfix-code-reviewer.md     ← 无关改动
??  docs/reviews/PRx-human-in-loop-code-review.md        ← 无关改动
??  docs/reviews/PRx-human-in-loop-review.md             ← 无关改动
```

**强制建议:** 在执行 `git add` 之前,先用 `git status` 确认工作区干净,或显式 `git add <明确清单>` 避免误带。前置 stage 1 / 2 / 3 调研产生的临时 plan / doc 文件不应混入本次 commit。

### `apply-search-name-column.ts` 处理建议

- 方案 A(推荐): **删除**该文件,DB schema 已通过 `prisma db push` 同步过,后续 `prisma db push` 也不会再用它
- 方案 B: 移到 `scripts/legacy/` 子目录 + 头部大注释说明"已废弃,生产环境已迁移,留作历史教训"
- 方案 C: 单独 commit `chore: add legacy column-add SQL escape hatch` 与本次 PR 隔离

---

## 踩坑对照(对照文档第 8 节)

本 PR 没找到踩坑记录文档,跳过此节。

---

## Positive Points

- ✅ 新增 `shared/lib/user-search.ts` 单一职责,纯函数可测
- ✅ `backfill-user-search-names.ts` 支持 `--dry-run`,生产风险可控
- ✅ `buildUserSearchTerms` 边界处理完善: 空 / null / 纯标点 → 返回 null
- ✅ `register` 路由的 zod schema 用 `min(1)` 强制 name 必填,避免 searchName 写入 null 时还能建 user
- ✅ `chineseToPinyin` 用 `pinyin-pro` 库 + `surname: "head"` 处理多音字,工程务实
- ✅ `searchName` 字段注释清晰 `// 所有变体空格分隔,冗余存储避免运行时计算`
- ✅ Step 1 / Step 2 (id 精确匹配 + name 精确匹配) 保留原逻辑,只是新增 Step 3,backward compatible

---

## Next Steps

1. 主代理: 把 Critical 1-3 转 fullstack-developer 修复,**至少 TypeScript 类型错误(resolveUser/listCandidateUsers 签名不一致)+ 重复定义 + 调试日志残留**
2. 全 Warning 项按优先级:
   - 高: 4 (写清单) / 8 (去重 `chineseToPinyin`)
   - 中: 5 (Step 5 加 early-exit) / 7 (改注释 + 补缺用例)
   - 低: 6 / 9 / 10 / 11 / 12 / 13
3. 主代理: 在用户确认 commit 前清理工作区无关文件,严格按 commit 范围清单 `git add`
4. main 主代理: 提交后跑 `npx prisma db push` + `npm run build` + 启动一次 `scripts/test-user-search.ts` 验证回填结果
