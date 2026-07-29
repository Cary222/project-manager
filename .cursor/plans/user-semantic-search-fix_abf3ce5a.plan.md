# 用户姓名语义搜索增强计划

> 状态：开发中
> 日期：2026-07-24
> 版本：v3（整合用户审查 + Human-in-Loop）
> 覆盖：v2 版本的 `.cursor/plans/user-semantic-search-fix_abf3ce5a.plan.md`

---

## 1. 问题陈述

### 1.1 现象

用户输入中文姓名查询周报或工作近况时，系统返回"未查询到该用户的结构化活动记录"。

**典型失败 case**：

| 用户输入 | DB 中的 name 字段 | 结果 |
|----------|-------------------|------|
| 张靖的周报 | Zhang Jing | ❌ LIKE '%张靖%' 不匹配英文 |
| jing zhang的周报 | Zhang Jing | ❌ 空格被截断为 "jing" |
| lhy 本周在干嘛 | Liu Haoyang | ❌ 拼音缩写无匹配 |
| 小张的工单 | 张靖 | ❌ 昵称不在 name 字段 |

### 1.2 失败链路

```
用户消息: "jing zhang的周报"
    ↓
extractUserIdentifier() → "jing"（空格截断）
    ↓
resolveUser("jing") → 5 轮 LIKE 查询全失败
    ↓
返回 null
    ↓
generateResponse → "暂未查询到该用户的结构化活动记录"
```

### 1.3 根因

1. 分词逻辑按空格截断，丢失完整拼音
2. `name` 字段只存一种格式，缺少搜索辅助字段
3. 昵称和缩写完全没有索引
4. 弱匹配直接 findFirst，可能误匹配同名用户

---

## 2. 架构结论

### 2.1 工具边界不变

| 工具 | 职责 | 不承担 |
|------|------|--------|
| `searchKnowledge` (RAG) | 语义内容检索 | 实体身份解析 |
| `searchStructured` (SQL) | 结构化数据查询 | 当前承担了实体解析，但算法太弱 |
| `webSearch` | 外部互联网检索 | 实体身份解析 |

### 2.2 最终架构

```
用户输入
    |
    v
extractUserIdentifier
    |
    |
 {raw, normalized}
    |
    v
resolveUser
    |
    +----------------+
    |                |
  强匹配             弱匹配
    |                |
直接返回          candidates
                     |
                     v
                confidence判断
                     |
                     v
            (Human-in-Loop)
              用户确认
                     |
                     v
searchStructured
    |
    +---- weeklyReport
    +---- ticket
    +---- project
```

### 2.3 审查修正要点（v2 → v3）

| 原方案 | 修正 | 原因 |
|--------|------|------|
| confidence 在 P1 返回 | → **P0.5 返回** | 避免 API 返工，提前稳定接口 |
| contains → findFirst | → **contains → candidates → ranking** | 避免误匹配同名用户 |
| "解决 80%/95%/98%" 硬指标 | → **删除，改用阶段描述** | 误导，实际场景复杂 |
| 弱匹配直接返回 | → **Human-in-Loop 让用户确认** | 多同名用户时必须人工介入 |

---

## 3. 分阶段实施计划

### 阶段目标（无硬指标）

| 阶段 | 目标 | 关键改动 |
|------|------|----------|
| **P0** | 常见输入不失败 | extractUserIdentifier 返回结构化对象 + searchName 字段 |
| **P0.5** | 支持企业内部昵称 | UserAlias 表 + **confidence 返回** |
| **P1** | 降低误匹配 | 弱匹配返回 candidates + Human-in-Loop |
| **P2** | 泛化实体系统 | EntityAlias 表（支持项目别名、Ticket 昵称） |

### P0 — 立即修复（1-2 天）

#### 3.1 修复 `extractUserIdentifier` — 返回结构化对象

**文件**: `features/ai/graph/nodes/search-structured.ts`

**改动**: 返回 `{ raw, normalized }` 对象，保留原始输入和归一化版本。

```typescript
interface ExtractedUser {
  raw: string;        // 原始输入：zhang jing
  normalized: string;  // 归一化：zhangjing（去空格/小写）
}

function extractUserIdentifier(content: string): ExtractedUser {
  // 1. 去除停用词和问句后缀
  let cleaned = content.replace(stopRegex, " ").replace(...).trim();

  // 2. 中文姓名优先（最长匹配）
  const chinese = cleaned.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chinese?.length > 0) {
    const raw = chinese.sort((a, b) => b.length - a.length)[0];
    return { raw, normalized: raw };
  }

  // 3. 拼音分词：同时返回 raw 和 normalized
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const raw = tokens.join(" ");     // "zhang jing"
    const normalized = tokens.join(""); // "zhangjing"
    return { raw, normalized: normalized.length >= 2 ? normalized : raw };
  }

  // 4. 单 token
  const raw = tokens[0] ?? cleaned;
  return { raw, normalized: raw };
}
```

#### 3.2 Prisma Schema — 增加 `searchName` 字段

**文件**: `prisma/schema.prisma`

```prisma
model User {
  id         String   @id @default(cuid())
  name       String?  // 显示用名称（中文或英文）
  searchName String?  // 搜索辅助字段：拼音全拼（zhangjingyang）
  // ... 现有字段 ...
  @@schema("pm")
}
```

#### 3.3 修改 `resolveUser` — 强匹配序列优化

**文件**: `features/ai/tools/search-structured.ts`

**前置条件**: `extractUserIdentifier` 现在返回 `{ raw, normalized }`。

```typescript
type MatchType = "id" | "name" | "searchName" | "alias" | "fuzzy";

interface ResolveResult {
  user: { id: string; name: string } | null;
  confidence: number;       // 0.0 - 1.0
  matchType: MatchType | null;
  candidates?: Array<{ id: string; name: string; email: string }>;
}

async function resolveUser(
  identifier: ExtractedUser | undefined,
  viewerUserId: string | undefined
): Promise<ResolveResult> {
  if (!identifier) return { user: null, confidence: 0, matchType: null };

  const { raw, normalized } = identifier;
  const rawTrimmed = raw.trim();
  const normTrimmed = normalized.trim();

  // === 强匹配（直接返回）===
  // Step 1: Exact id match - confidence 1.0
  const byId = await prisma.user.findUnique({
    where: { id: rawTrimmed },
    select: { id: true, name: true },
  });
  if (byId) return { user: { id: byId.id, name: byId.name ?? byId.id }, confidence: 1.0, matchType: "id" };

  // Step 2: Exact name match - confidence 1.0
  const byName = await prisma.user.findFirst({
    where: { name: { equals: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true },
  });
  if (byName) return { user: { id: byName.id, name: byName.name ?? byName.id }, confidence: 1.0, matchType: "name" };

  // Step 3: searchName contains - confidence 0.95
  if (normTrimmed.length >= 2) {
    const bySearchName = await prisma.user.findFirst({
      where: { searchName: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
      select: { id: true, name: true },
    });
    if (bySearchName) return { user: { id: bySearchName.id, name: bySearchName.name ?? bySearchName.id }, confidence: 0.95, matchType: "searchName" };
  }

  // === 弱匹配（返回 candidates）===
  // Step 4: name contains → candidates
  if (normTrimmed.length >= 1) {
    const candidates = await prisma.user.findMany({
      where: { name: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (candidates.length > 0) {
      return { user: null, confidence: 0.7, matchType: "name", candidates };
    }
  }

  // Step 5: email prefix → candidates
  const byEmailPrefix = await prisma.user.findMany({
    where: { email: { startsWith: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (byEmailPrefix.length > 0) {
    return { user: null, confidence: 0.85, matchType: "name", candidates: byEmailPrefix };
  }

  return { user: null, confidence: 0, matchType: null };
}
```

#### 3.4 数据迁移

```bash
# 填充现有用户的 searchName（需要人工或脚本）
# 对于英文名 "Zhang Jing Yang" → searchName: "zhangjingyang"
```

---

### P0.5 — 用户别名 + 置信度返回（2-3 天）

#### 3.5 Prisma Schema — 增加 `UserAlias` 表

**文件**: `prisma/schema.prisma`

```prisma
model UserAlias {
  id     String @id @default(cuid())
  userId String
  alias  String // 别名值：小张、lhy、老王、三哥
  type   String // 类型：nickname | pinyin_abbr | username | custom

  user   User   @relation(fields: [userId], references: [id])

  @@unique([userId, alias])
  @@index([alias])
  @@schema("pm")
}
```

**设计说明**:
- 不需要 `weight`、`confidence`、`source` 字段
- `type` 字段简单标记来源，不参与打分
- 唯一性约束避免重复别名

#### 3.6 修改 `resolveUser` — 查询 `UserAlias` 表 + 返回置信度

**文件**: `features/ai/tools/search-structured.ts`

在 Step 3 (searchName) 之后添加 alias 匹配：

```typescript
// Step 4: UserAlias exact match (raw input) - confidence 1.0
const byAliasRaw = await prisma.userAlias.findFirst({
  where: { alias: { equals: rawTrimmed, mode: "insensitive" } },
  include: { user: { select: { id: true, name: true } } },
});
if (byAliasRaw) {
  return {
    user: { id: byAliasRaw.user.id, name: byAliasRaw.user.name ?? byAliasRaw.user.id },
    confidence: 1.0,
    matchType: "alias"
  };
}

// Step 5: UserAlias contains (normalized input) - confidence 0.9
if (normTrimmed.length >= 2) {
  const byAliasNorm = await prisma.userAlias.findFirst({
    where: { alias: { contains: normTrimmed, mode: "insensitive" } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (byAliasNorm) {
    return {
      user: { id: byAliasNorm.user.id, name: byAliasNorm.user.name ?? byAliasNorm.user.id },
      confidence: 0.9,
      matchType: "alias"
    };
  }
}
```

#### 3.7 别名初始化脚本

**文件**: `scripts/ai/user-alias-init.ts`

```typescript
// 自动生成别名：
// 1. username (来自 OAuth 账号) → type: username
// 2. email 前缀 → type: username
// 3. 常见昵称（需要用户提供）
```

---

### P1 — Human-in-Loop 交互（3-5 天）

#### 3.8 修改 `resolveUser` — 弱匹配返回 candidates

**核心改动**：弱匹配不再直接 `findFirst`，而是返回 candidates 列表。

```typescript
// Step 6: name contains → candidates（不再直接 findFirst）
if (normTrimmed.length >= 1) {
  const candidates = await prisma.user.findMany({
    where: { name: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true, email: true },
  });

  if (candidates.length === 1) {
    // 唯一候选 → 直接返回
    return { user: candidates[0], confidence: 0.7, matchType: "name" };
  }

  if (candidates.length > 1) {
    // 多候选 → Human-in-Loop
    return { user: null, confidence: 0.5, matchType: "name", candidates };
  }
}

// Step 7: email prefix → candidates
const byEmailPrefix = await prisma.user.findMany({
  where: { email: { startsWith: normTrimmed, mode: "insensitive" }, bannedAt: null },
  select: { id: true, name: true, email: true },
});
if (byEmailPrefix.length > 0) {
  return {
    user: byEmailPrefix.length === 1 ? byEmailPrefix[0] : null,
    confidence: byEmailPrefix.length === 1 ? 0.85 : 0.6,
    matchType: "name",
    candidates: byEmailPrefix.length > 1 ? byEmailPrefix : undefined
  };
}

// Step 8: email contains → candidates
if (normTrimmed.includes("@") || normTrimmed.includes(".")) {
  const byEmailContains = await prisma.user.findMany({
    where: { email: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (byEmailContains.length > 0) {
    return {
      user: byEmailContains.length === 1 ? byEmailContains[0] : null,
      confidence: byEmailContains.length === 1 ? 0.8 : 0.5,
      matchType: "name",
      candidates: byEmailContains.length > 1 ? byEmailContains : undefined
    };
  }
}

return { user: null, confidence: 0, matchType: null };
```

#### 3.9 修改 Graph State — 增加 `pendingConfirmation` 状态

**文件**: `features/ai/graph/state.ts`

```typescript
interface AgentState {
  messages: BaseMessage[];
  mode: "auto" | "search" | "chat" | "web";
  searchResults?: string[];
  response?: string;
  // Human-in-Loop 新增
  pendingConfirmation?: {
    type: "user_disambiguation";
    candidates: Array<{ id: string; name: string; email: string }>;
    query: string;
  };
}
```

#### 3.10 修改 `searchStructuredNode` — 处理 candidates

**文件**: `features/ai/graph/nodes/search-structured.ts`

```typescript
// 在节点执行后检测是否需要人工介入
if (result.attribution?.candidates && result.attribution.candidates.length > 1) {
  return {
    ...result,
    pendingConfirmation: {
      type: "user_disambiguation",
      candidates: result.attribution.candidates,
      query: extractedUser,
    },
    // 不设置 searchResults，让 generateResponse 生成询问消息
  };
}
```

#### 3.11 修改 `generateResponse` — 生成询问消息

**文件**: `features/ai/graph/nodes/generate-response.ts`

```typescript
// 检测 pendingConfirmation
if (state.pendingConfirmation?.type === "user_disambiguation") {
  const { candidates, query } = state.pendingConfirmation;
  const options = candidates.map((u, i) => `${i + 1}. ${u.name}（${u.email}）`).join("\n");

  return {
    messages: [...state.messages, new AIMessage(
      `我找到了多个与"${query}"相关的用户，请选择或输入更具体的信息：\n\n${options}\n\n请输入数字或姓名确认。`
    )],
    waitingForConfirmation: true,
  };
}
```

#### 3.12 修改 `routing.ts` — Human-in-Loop 节点

**文件**: `features/ai/graph/edges/routing.ts`

```typescript
export function routeAfterGenerateResponse(state: AgentState): string {
  // 如果需要用户确认，等待用户输入
  if (state.waitingForConfirmation) {
    return "human_confirmation";
  }

  // 正常流程结束
  return "__end__";
}

export function humanConfirmation(state: AgentState): Partial<AgentState> {
  // 从用户消息中解析选择
  const lastMessage = state.messages[state.messages.length - 1].content as string;

  // 解析数字选择或姓名输入
  const selectedId = parseUserSelection(lastMessage, state.pendingConfirmation?.candidates);

  if (selectedId) {
    return {
      selectedUserId: selectedId,
      waitingForConfirmation: false,
      pendingConfirmation: undefined,
    };
  }

  // 无法解析，返回错误
  return {
    waitingForConfirmation: false,
    pendingConfirmation: undefined,
  };
}
```

#### 3.13 前端 Human-in-Loop 交互

**文件**: `features/ai/ui/AiChatPanel.tsx`

```typescript
// 检测 pendingConfirmation 类型的消息
if (message.type === "pending_confirmation") {
  return (
    <div className="flex flex-col gap-2 p-4 bg-warning/10 border border-warning/30 rounded-lg">
      <div className="text-sm text-warning-foreground font-medium">
        请选择用户：
      </div>
      <div className="space-y-2">
        {message.candidates.map((user) => (
          <button
            key={user.id}
            onClick={() => selectCandidate(user.id)}
            className="w-full text-left px-3 py-2 rounded hover:bg-warning/20 transition-colors"
          >
            <span className="font-medium">{user.name}</span>
            <span className="text-sm text-muted-foreground ml-2">{user.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

### P2 — 泛化与项目别名（长期，5-10 天，按需）

#### 3.14 EntityAlias 泛化表

**文件**: `prisma/schema.prisma`

```prisma
model EntityAlias {
  id         String  @id @default(cuid())
  entityType String  // user | project | ticket | file
  entityId   String
  alias      String
  type       String  // manual | auto_pinyin | auto_english

  @@unique([entityType, entityId, alias])
  @@index([entityType, alias])
  @@schema("pm")
}
```

**应用场景**:
- 项目别名："A项目" → Project #10
- Ticket 昵称："那个 bug" → Ticket #10156
- 文件别名："设计稿" → File #xxx

#### 3.15 structured 文件拆分（可选）

**时机**: 当 `search-structured.ts` 超过 400 行时。

**目标结构**:

```
features/ai/tools/structured/
  index.ts           # tool 定义 + inputSchema
  user.ts            # resolveUser + extractUserIdentifier
  ticket.ts          # queryTicket
  project.ts         # queryProject
  commit.ts          # queryCommit
  weekly-report.ts   # queryWeeklyReport
  shared.ts          # 类型定义 + 公共函数
```

---

## 4. 多路匹配算法

### 4.1 匹配阶段与置信度

```
输入: "jingzhangyang" 或 "jing zhang"

┌────────────────────────────────────────────────────────────┐
│  Step   置信度   查询方式                目标               │
├────────────────────────────────────────────────────────────┤
│  1      1.0      id exact               精确 ID           │
│  2      1.0      name exact             精确名称           │
│  3      0.95     searchName contains    拼音全拼           │
│  4      1.0      UserAlias exact        别名精确           │
│  5      0.9      UserAlias contains     别名模糊           │
│  6      0.7      name contains → candidates→ranking     │
│  7      0.85     email prefix → candidates               │
│  8      0.8      email contains → candidates              │
└────────────────────────────────────────────────────────────┘

强匹配（Step 1-5）：直接返回结果
弱匹配（Step 6-8）：
  - 唯一候选 → 返回（confidence 降低）
  - 多候选 → 返回 candidates，等待 Human-in-Loop
```

### 4.2 各匹配方式适用场景

| 输入 | 匹配方式 | 结果 |
|------|----------|------|
| zhangjingyang | searchName contains | ✅ 命中 |
| zhang jing | raw → UserAlias exact | ✅ 命中 |
| lhy | UserAlias contains | ✅ 命中 |
| 小张 | UserAlias exact | ✅ 命中 |
| 张靖（中文） | name contains | ✅ 唯一 → 返回；❌ 多名 → 候选 |
| "张" | 所有方式 | ❌ 太多候选 → 返回 candidates |

### 4.3 向量搜索的决定

**不使用向量搜索的原因**：

1. **名字是低语义、高唯一性**：张靖和张静在向量空间中相似，但业务上是不同的人
2. **企业场景主要问题是人为约定**：小张/老王/lhy 是人定义的别名，不是语义等价
3. **pg_trgm 覆盖真实场景**：打字容错、拼音空格变体都能覆盖
4. **向量延迟不必要**：增加 200-500ms 延迟，而 SQL LIKE 只需 < 5ms

---

## 5. 文件变更清单

| 文件 | 变更类型 | 优先级 |
|------|----------|--------|
| `prisma/schema.prisma` | 增加 `searchName` 字段 | P0 |
| `prisma/schema.prisma` | 增加 `UserAlias` 表 | P0.5 |
| `prisma/schema.prisma` | 增加 `EntityAlias` 表 | P2 |
| `features/ai/graph/nodes/search-structured.ts` | extractUserIdentifier 返回 `{ raw, normalized }` | P0 |
| `features/ai/tools/search-structured.ts` | resolveUser 返回 ResolveResult + candidates | P0.5 |
| `features/ai/graph/state.ts` | 增加 pendingConfirmation 状态 | P1 |
| `features/ai/graph/edges/routing.ts` | 增加 human_confirmation 路由 | P1 |
| `features/ai/graph/nodes/generate-response.ts` | 置信度询问消息生成 | P1 |
| `features/ai/ui/AiChatPanel.tsx` | Human-in-Loop 交互组件 | P1 |
| `scripts/ai/user-alias-init.ts` | 新建别名初始化脚本 | P0.5 |

---

## 6. 风险与约束

| 风险 | 影响 | 缓解 |
|------|------|------|
| searchName 数据质量 | 部分用户拼音不准确 | 用户可手动修正 |
| UserAlias 维护成本 | 昵称需要手动维护 | 未来加 UI 入口（P2） |
| 多 "小王" 歧义 | 多个同名用户 | P1 的 candidates + Human-in-Loop 解决 |
| Human-in-Loop 延迟 | 用户需要等待交互 | 仅在多候选时触发，单一命中无感知 |

---

## 7. 优先级总结

| 优先级 | 任务 | 预期效果 |
|--------|------|----------|
| **P0** | extractUserIdentifier 返回 `{ raw, normalized }` | "jing zhang" 不再被截为 "jing" |
| **P0** | User 表增加 `searchName` 字段 | 支持 "zhangjingyang" 匹配 |
| **P0.5** | UserAlias 表（简化设计） | 支持小张/lhy/老王等昵称和缩写 |
| **P0.5** | resolveUser 返回 confidence + matchType | 提前稳定接口，避免 API 返工 |
| **P0.5** | 别名初始化脚本 | 数据准备 |
| **P1** | 弱匹配返回 candidates + Human-in-Loop | 多同名用户时人工确认 |
| **P1** | generateResponse 置信度询问消息 | 多候选时生成选择菜单 |
| **P1** | 前端 Human-in-Loop 交互 | 用户点击选择目标用户 |
| **P2** | EntityAlias 泛化表 | 支持项目别名、Ticket 昵称 |
| **P2** | structured 文件拆分 | 等超过 400 行再拆 |

---

## 8. 与 v2 版本对比

| 变更项 | v2 | v3（本版） |
|--------|-----|-----------|
| extractUserIdentifier 返回值 | `{ raw, normalized }` | `{ raw, normalized }` (不变) |
| resolveUser 返回值 | `{ user, confidence }` | `{ user, confidence, matchType, candidates }` |
| 弱匹配处理 | contains → findFirst 直接返回 | contains → candidates → 唯一则返回，多则 Human-in-Loop |
| 硬指标 | 80%/95%/98% | 删除，改用阶段描述 |
| confidence 返回时机 | P1 | P0.5（提前） |
| Human-in-Loop | P2 | P1（结合 LangGraph 学习计划） |
| pg_trgm | P1 | P0.5（简化为 alias） |
