<!-- reviewer: ai-learning-mentor (软层) -->

# PR11 — file-asset-projectid 方案 A 软层审查

> 审查者身份：ai-learning-mentor（软层：架构契合度 / 方案取舍 / 可维护性 / 学习价值）
> 硬层（类型 / 安全 / N+1 / 错误处理）不在本审查范围内，由 code-reviewer 负责。
> 注：当前 HEAD 为 main 分支，PR 编号按上下文约定为 PR11。

---

## 审查结论

**APPROVED**

方案 A 的核心设计——在 Worker 层通过 `resolveProjectIdFromFileAsset` 做 FileReference 链反查——符合 ProjectHub 现有架构风格，取舍逻辑自洽。存在 2 个**建议优化**（非 Critical），不影响合并决策。

---

## 软层审查

### 1. 架构契合度

**符合 PR10"FileReference 唯一权威"原则。**

PR10 的核心设计决策是：所有文件引用都必须经过 `FileReference` 表，FileReference 是"文件属于哪里"的唯一权威数据源（参考 `docs/features/file-upload.md` 第 175 行）。方案 A 完全复用这个设计，不在 `FileAsset` 表上新增 `projectId` 字段。

**一个值得思考的取舍点——为什么选 Worker 层反查，而不是上传入口直接写 `projectId`？**

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **上传入口写** | `POST /api/upload` 时从请求上下文拿 `projectId` 写入 | 一次查询搞定，无需 Worker 额外操作 | 调用方必须知道 projectId（有些场景不一定知道，比如跨项目引用附件） |
| **方案 A：Worker 反查** | Worker 处理时通过 FileReference 链反查 | 调用方零感知，FileReference 权威不变 | 多一次 DB 查询（但只在 Worker 处理时发生，不是每次上传） |

当前实现选择方案 A 的理由是：附件上传入口（`POST /api/upload`）目前没有请求上下文里的 `projectId`，强行在上游塞会破坏现有调用链路。**这个取舍是合理的**——让 Worker 层做这件事，上传入口完全不用改，后续任何地方上传附件都能自动获得 projectId。

> **一个类比**：就像快递柜的"寄件人地址"。你不需要在寄件时手动填地址，快递员会根据你的身份证信息反查。同理，Worker 层根据 FileReference 链反查 projectId，上传入口零改动。

**唯一要注意的是**：未来如果新增一个 `FILE_ASSET` sourceType（文件直接上传，不挂任何实体），这个反查就会失败，返回 null。这在可维护性章节会再讨论。

---

### 2. 方案取舍复盘

#### 边界问题："一个文件关联多个 project" 是否被正确处理？

**方案 A 在这个问题上选择了"不强约束，允许 null"**。

`SearchDocument.projectId` 字段类型是 `String?`（schema.prisma 第 130 行），允许 null。这意味着：
- 如果 FileReference 链能查到 projectId → 填入 projectId
- 如果查不到（边界情况）→ projectId 为 null

**这个选择是务实的。** 在 ProjectHub 的实际业务中：
- 工单评论的附件 → 属于工单 → 属于项目 ✅
- PKM 笔记的附件 → 属于笔记 → 属于项目 ✅
- 未来如果真的出现"跨项目共享附件"需求，null 也能兜住

**与方案 B 的对比**（纯理论层面）：

方案 B 如果走"上传入口直接拿 projectId"，就意味着"强制要求每个上传都有 projectId"。这会导致两种尴尬：
1. 临时附件（还没决定挂哪个项目的文件）无法上传
2. 跨项目附件需要额外的多对多关联表

方案 A 的 null 容错机制，实际上回避了这两种尴尬。

**结论**：边界问题处理得当，不需要为了"多 projectId" 做过度设计。

---

### 3. 可维护性

#### switch case 扩展性

`resolveProjectIdFromFileAsset` 的 switch case（`document.ts` 第 46-72 行）目前覆盖 4 种 sourceType：

```
PKM_NOTE       → 查 PkmNote.projectId
TICKET         → 查 Ticket.projectId
TICKET_COMMENT → 查 TicketComment → Ticket.projectId
PROJECT        → 直接返回 sourceId
```

**扩展性分析：**

| 新增 sourceType | 需要改几处 |
|----------------|-----------|
| `REPO`（代码仓库附件） | 需要新增 case 块 |
| `PROJECT_ANNEX`（项目公告附件） | 需要新增 case 块 |
| `DIRECT_UPLOAD`（未来直接上传，不挂实体） | 当前 default 返回 null 是对的 |

**风险点**：如果未来新增 sourceType 但忘记在 switch 里加 case，默认行为是返回 null。这个 null 会一路透传到 `SearchDocument.projectId`。**这可能导致该文件的向量无法按项目过滤**，但不会导致整个流程崩溃（降级为"全局可见"）。

**建议**：在函数头注释里加一行 `@requires 新增 sourceType 时同步更新此 switch`，降低后续接手者漏改的风险。

#### 当前 switch 是否完整？

检查现有调用方：`recordFileReference` 的 sourceType 由调用方传入。grep `FileReferenceSourceType` 的使用点，确认当前所有调用都落在上述 4 种之内：

- 工单评论附件 → `TICKET_COMMENT` ✅
- PKM 笔记附件 → `PKM_NOTE` ✅
- 工单内直接上传附件（如果存在）→ `TICKET` ✅

暂时没有不在这个范围内的调用方。

---

### 4. 学习价值

#### 是否符合 ProjectHub 现有架构风格？

**符合。**

ProjectHub 的一个核心架构风格是：**通过中间表（FileReference）做间接关联，而不是在每个实体上直接塞外键**。这个模式在 PR10 的设计里已经很清晰：

```
FileAsset（文件本体）
    ↓ 1:N
FileReference（文件引用链）→ PKM_NOTE / TICKET / TICKET_COMMENT / PROJECT
    ↓ 顺藤摸瓜
PkmNote / Ticket / TicketComment / Project → projectId
```

方案 A 延续了这个风格，Worker 层通过 FileReference 链反查，不需要在 FileAsset 上加 projectId 字段。

#### 会让后续接手者困惑吗？

**基本不会，但有一处可能需要澄清**：

`resolveProjectIdFromFileAsset` 使用 `findFirst` + `orderBy: "asc"` 取第一条 FileReference（`document.ts` 第 39-43 行）。如果同一个文件被多个地方引用（理论上 FileReference 支持），只取第一条。这在当前业务里是合理的（一个附件通常只属于一个上下文），但注释里没有说明这个设计决策。

**建议**：注释加一句 `// 取第一条引用（当前业务场景下文件通常只被一个上下文引用）`。

---

## Critical 问题（必须修复）

**无 Critical 问题。**

本审查为软层，架构设计自洽，取舍合理。

---

## 建议优化（可选）

### 建议 1：switch case 扩展性注释

**位置**：`document.ts` 第 36-73 行（`resolveProjectIdFromFileAsset` 函数头）

**内容**：在 JSDoc 注释里加一行扩展性提醒：

```typescript
/**
 * 通过 FileReference 链反查 projectId。
 * ...
 * @requires 新增 sourceType 时同步更新此 switch
 */
```

**理由**：降低后续接手者漏改的风险。当前 4 种 sourceType 还算好管，但随着业务增长，这个 switch 可能变成隐患。

---

### 建议 2：取第一条 FileReference 的设计意图注释

**位置**：`document.ts` 第 42 行（`orderBy: { createdAt: "asc" }` 附近）

**内容**：加一句注释说明为什么只取第一条：

```typescript
// 取第一条引用（当前业务场景下文件通常只被一个上下文引用）
// 如未来需要支持多引用，此处逻辑需改为取首个非 null projectId 或报错
```

**理由**：让接手者理解这个"取第一条"不是 bug，而是有意为之的设计。

---

## 总结

方案 A 是一个**架构契合度高、取舍清晰、风险可控**的实现。核心价值：

1. **不破坏现有上传入口**——调用方零感知
2. **复用 FileReference 权威设计**——与 PR10 原则一致
3. **null 容错机制**——避免过度约束，业务灵活性好

两个建议优化都是**文档层面的改进**，不影响功能正确性，可选择性采纳。

**软层审查通过，可进入合并流程。**
