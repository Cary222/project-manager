<!-- reviewer: ai-learning-mentor (软层二次) -->
# PR10208 Chat 模式识图 — 软层二次评估（修复必要性）

> **审查日期**：2026-08-14
> **审查范围**：code-reviewer 提的 3 Critical + 8 Warning 是否都需要修复
> **审查身份**：ai-learning-mentor（软层架构 + 学习价值）
> **前置审查**：
> - `docs/reviews/PR10208-chat-vision-ai-mentor.md` — 软层首轮（APPROVED）
> - `docs/reviews/PR10208-chat-vision-code-reviewer.md` — 硬层（CHANGES_REQUIRED）
> - `docs/reviews/PR10208-chat-vision-review.md` — Main 合并

---

## 二次评估结论

**11 项里 10 项"必修复"，1 项"可推迟"，0 项"过度设计"。**

Mentor 在二次评估中没有发现硬层审查是 gold-plating 的痕迹。所有提出的问题都是真实风险或正确性问题，但**优先级可以分层**。

---

## 逐项软层判断

| ID | 软层判断 | 推荐动作 | 优先级 |
|---|---|---|---|
| **C1** (firstMessage 路径丢图) | **必修复** | 真实用户路径缺陷 | P0 |
| **C2** (legacy 路径不支持图片) | **必修复** | 环境配错就静默失效（cheap defense） | P0 |
| **C3** (resolveCurrentInputImages 串行 N+1) | **必修复** | trivially cheap 性能修复；history helper 已用 `Promise.all` 形成对比 | P0 |
| **W5** (乐观 UI 不显示图片) | **必修复** | 真实用户感知 UX 缺陷（"上传了图 → 发送 → 图没了 → 刷新又出现"），修复成本极低 | P0 |
| **W8** (validateInputImageOwnership 失败被吞) | **必修复** | 安全审计 + trivially cheap（1-2 行） | P0 |
| **W4** (文档/实现不一致) | **必修复** | 1 行注释修复，消除误导 | P1 |
| **W2** (validate + resolve 重复查 DB) | **必修复** | trivially cheap 性能修复 | P1 |
| **W6** (inputImageIds 数量无上限) | **必修复（但用合理上限 8 或 10，而非 hardcode 2）** | 防止前端绕过 UI 限制。Plan 里说"最多 2 张"过严，留扩展余地 | P1 |
| **W1** (history 图片 token 预算) | **必修复（采用简化方案）** | 真实成本风险。建议每张图固定 ~700 token 计入 `truncateHistoryByToken` | P1 |
| **W3** (`as any` 注释) | **必修复** | 1 行注释，可读性问题 | P2 |
| **W7** (resolveHistoryInputImages 失败日志) | **可推迟到 PR follow-up** | 排查体验改进，不是 correctness 缺陷；建议合并到 W1 一起改（同一段 history window 函数） | follow-up |

---

## 维度说明

- **必修复**：影响正确性 / 安全 / 用户体验的明确缺陷
- **可推迟**：本次 PR 不修（属 follow-up），但需要明确记入 ADR 或 PR 描述
- **过度设计**：硬层审查是 gold-plating，不该被采纳

---

## 优先级分层（建议修复顺序）

### P0 — 必修（6 项）

1. **C1** — `/api/ai/conversations` 接 `inputImageIds`
2. **C2** — legacy 路径支持图片
3. **C3** — `resolveCurrentInputImages` 改 `Promise.all`
4. **W5** — 乐观 UI 显示用户图片
5. **W8** — `validateInputImageOwnership` 失败 warn 日志
6. **W4** — 注释对齐实际行为

### P1 — 应修（4 项）

7. **W2** — 合并 validate + resolve 为单次 DB 查询
8. **W6** — zod `.max(8)` 留余地（不用 2）
9. **W1** — history window 加图片 token cost（每张 ~700 token，优先淘汰带图旧轮次）
10. **W3** — `as any` 注释解释 LangChain AIMessage 构造器限制

### follow-up（1 项）

- **W7** — history 失败日志样本（合并到 W1 一起改可同时落地，也可单独推迟）

---

## 用户原话备注

用户原话提到：
> ownerId=NULL 旧行 → 在 PR 描述里写明"保留 NULL，不强制回填"。如果你同意这个策略（W4 在 PR 描述里说明，不修代码），请在 W4 行里指明。

**Mentor 注**：原话中的"W4 在 PR 描述里说明"——根据硬层审查编号 W4 是"文档/实现不一致"（注释说 502 实际降级），与 ownerId 政策不同。

ownerId=NULL 政策属于硬层审查的 SG2（Suggestion）：保留 NULL 不强制回填。**Mentor 同意这个策略**：
- 历史 24 条 NULL 行短期不影响（`validateInputImageOwnership` 用 `ownerId === userId` 而非 `NOT NULL` 表达）
- 在 PR 描述里说明即可，不需修代码
- 如未来加"非 owner 无法引用"的硬性规则，再回头补回填脚本

---

## 与硬层审查的关系

本次二次评估确认了硬层审查的判断（无 gold-plating），但**给出了执行优先级**：
- P0（6 项）= 修复成本极低且影响用户/安全/正确性
- P1（4 项）= 必要改进但可放在第二轮
- follow-up（1 项）= 可观测性增强

**建议**：Main 一次性完成 P0（≤ 6 项）+ P1（≤ 4 项），预计工作量 1-1.5 小时。