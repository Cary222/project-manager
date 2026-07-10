<!-- reviewer: code-reviewer (硬层) -->

## 审查结论

对 `search-knowledge.ts` 和 `search-structured.ts` 的 tool `description` 文本进行硬层审查（歧义 / 矛盾 / 完整性 / LLM 可执行性）。

**Scope:** `features/ai/tools/search-knowledge.ts` + `features/ai/tools/search-structured.ts`
**Review Type:** Local Changes（描述文本审查）
**tsc:** ⚠️ 1 个已存在的 TS 错误（见已知历史遗留，不计入本次审查）

---

### Verdict: ⚠️ Approved with Suggestions

两份 description 整体方向正确，定位互补清晰，适用场景区分度足够。但存在 **3 处边界模糊** 可能导致 LLM 在特定 query 类型上选错工具，以及 **2 处描述缺口** 应补充以提升 LLM 决策质量。

---

### Findings

#### Critical (Must Fix)

无。

---

#### Improvements (Recommended)

**1. `features/ai/tools/search-structured.ts:487` — "过滤查询" 与 `searchKnowledge` 存在语义重叠**

`searchStructured` 的适用场景列举了"按 status/priority/userId/projectId 过滤"，但这些过滤条件如果来自模糊描述怎么办？例如：

> "小张正在做的所有高优先级工单"

用户不知道小张的 userId，需要语义匹配。`searchKnowledge` 的适用场景也包含"语义模糊的问题"，与"过滤查询"边界不清晰。

**Impact**: LLM 可能选 `searchKnowledge` 来处理本该用 `searchStructured` 的场景（反之亦然）。
**Suggestion**: 在 `searchStructured` 的【不擅长】段补充：
```
- 语义描述 → 精确 ID/过滤条件 的转换（如"小张的工单"需要先找小张是谁）→ 两者皆可用，但从【用户说不清楚要找什么】开始 → 用 searchKnowledge
```

---

**2. `features/ai/tools/search-knowledge.ts:30` — "需要跨类型综合结果" 表述模糊**

"跨类型"没有定义具体是哪几种类型。LLM 可能会疑惑：ticket + commit？ticket + user？user + weekly_report？

**Impact**: LLM 可能低估 `searchKnowledge` 的适用范围，或不敢使用它来处理多类型混合 query。
**Suggestion**: 改为具体列举：
```
- 需要跨类型综合结果（同时涉及人+工单+笔记的讨论）
```
→
```
- 需要跨类型综合结果（人/工单/笔记/讨论中同时检索）
```

---

**3. `features/ai/tools/search-knowledge.ts:25` / `features/ai/tools/search-structured.ts:481` — "第二步/第一步" 定位缺乏可执行指引**

两份 description 都用了"分层查询的第 N 步"来描述定位，但：

- `mode=auto` 时，`searchStructured` 在工具数组里排第一（`searchStructured, searchKnowledge`），工具顺序不代表使用顺序
- LLM 实际调用取决于 prompt 里对 description 的解读，不一定按顺序

**Impact**: "第一步" / "第二步" 可能被 LLM 误解为"总是先调用第一个"，在 `search` 模式下（`searchKnowledge` 在前）尤其容易混淆。
**Suggestion**: 在 description 开头加一句：
```
【使用策略】：LLM 应根据 query 类型（见适用场景）直接选工具，不受工具注册顺序影响
```

---

#### Nitpicks (Optional)

**1. 两份 description 的"【不擅长】"段均未说明"查不到时怎么办"**

两份都有"请用另一个工具"引导，但没有说明：
- 当第一个工具返回空结果时，LLM 是否应该尝试另一个工具
- 这属于工具调用策略，超出了 description 范围——但可以加一行：
```
（若不确定从哪个开始，先尝试 searchStructured，再根据需要换 searchKnowledge）
```

**2. `searchKnowledge` description 中"第 N/M 段"表述可能让 LLM 困惑**

"返回相关文档片段 + 在长笔记中的位置（第 N/M 段）"——N/M 语义不明确，是分页还是文档内的段落索引？建议改为：
```
- 返回相关文档片段（长笔记显示所在段落，如"第 2/5 段"）
```

**3. `searchStructured` description 中"commit SHA"的大小写/长度未说明**

"支持 id（commit SHA 前缀）"——LLM 知道 SHA 可以只给前几位（7 位）吗？`search-structured.ts:379` 实际实现是 `startsWith`，可以补充：
```
- 支持 id（commit SHA 前缀，如 7 位：abc1234）
```

---

### Positive Points

- 两份 description 互补性良好：`searchKnowledge` 定义了"深挖"（语义、模糊、跨类型），`searchStructured` 定义了"浅查"（精确 ID、统计、列表），分工明确
- "【不擅长 - 请用 XXX】" 结构一致，引导 LLM 在选错工具后纠错
- `searchKnowledge` 的"关键词不明确时"场景（"最近相关的讨论"、"类似的问题"）描述具体，LLM 容易判断
- `searchStructured` 的 `type` 枚举在 description 中完整列举（ticket/project/user/commit/weekly_report），LLM 可直接参考
- `searchKnowledge` 的输出特点（文档片段位置、附件索引状态、语义相似度排序）对 LLM 是有效提示，可据此生成更好的响应

---

### Next Steps

1. **建议采纳**：3 处 Improvements 改进 description 文本（最优先处理 #3 "使用策略"和 #2 "跨类型"）
2. **可选采纳**：3 处 Nitpicks 提升描述精确度
3. **不阻断**：description 改动不涉及代码逻辑，无需 tsc 验证，直接可合并

---

### 已知历史遗留（tsc）

- `app/api/ai/conversations/[id]/messages/route.ts:231` — `setSearchKnowledgeConversationId` 找不到，PR9 复现文档第 8 节"踩坑记录"中已记录，非本次改动引入，不计入本次审查
