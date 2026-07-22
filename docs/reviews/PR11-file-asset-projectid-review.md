# PR11 — file-asset-projectid 审查合并报告

> 合并者：Main agent
> 来源：`docs/reviews/PR11-file-asset-projectid-code-reviewer.md` + `docs/reviews/PR11-file-asset-projectid-ai-mentor.md`

---

## 合并结论

**APPROVED — 无 Critical 问题，可合并。**

| 审查维度 | code-reviewer | ai-learning-mentor | 合并结论 |
|----------|--------------|---------------------|----------|
| 类型安全 | ✅ | — | APPROVED |
| 错误处理 | ✅ | — | APPROVED |
| N+1 风险 | ✅ | — | APPROVED |
| 性能 | ✅ | — | APPROVED |
| 事务一致性 | ✅ | — | APPROVED |
| PR11 兼容 | ✅ | — | APPROVED |
| 架构契合度 | — | ✅ | APPROVED |
| 方案取舍 | — | ✅ | APPROVED |
| 可维护性 | — | ⚠️ 建议加注释 | ✅ 已采纳 |

---

## Critical 问题

**无。**

---

## 建议优化（已采纳并落地）

### 1. ✅ 已采纳：switch case 扩展性注释

在 `resolveProjectIdFromFileAsset` 函数 JSDoc 中新增：

```
@requires 新增 sourceType 时同步更新此 switch，否则默认返回 null
@requires 取第一条引用（当前业务场景下文件通常只被一个上下文引用）
         如未来需要支持多引用，此处逻辑需改为取首个非 null projectId 或报错
```

### 2. ⚠️ 未采纳（低优先级）

`bytes` 类型 cast 的 eslint-disable 改为文件级禁用——这是 style 优化，不影响功能正确性，可作为 follow-up 处理。

---

## 实施摘要

| 项目 | 内容 |
|------|------|
| **改动文件** | `shared/lib/document.ts`（1 个文件） |
| **是否需要 migration** | 否（零 schema 改动） |
| **上线部署风险** | 极低（纯代码改动） |
| **改动量** | ~40 行（新增 helper + 1 行调用 + 注释增强） |

---

## 验证计划

上线后需验证：
1. 上传 PKM_NOTE 附件 → SearchDocument.projectId 等于该笔记所属项目的 id
2. 上传 Ticket 附件 → SearchDocument.projectId 等于该 Ticket 的 projectId
3. 上传 TicketComment 附件 → SearchDocument.projectId 等于该评论所属 Ticket 的 projectId
4. 无 FileReference 的 FileAsset → projectId = null，不报错
5. AI /knowledge 搜索项目文档 → 能按项目过滤，返回正确结果
