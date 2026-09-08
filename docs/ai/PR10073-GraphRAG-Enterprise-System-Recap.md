# #10073 GraphRAG 与企业级知识检索系统升级复现手册

> **工单**：#10073  
> **适用项目**：ProjectHub（Next.js 16 + Turbopack + PostgreSQL 16 + pgvector + Prisma）  
> **文档目标**：让任何新同学或未来的维护者在拿到本手册与 Git 提交后，能完整理解并 1:1 复现 GraphRAG、全链路检索路由、轻量语义重排、父子分块扩展、LLM Wiki 知识层与 LangGraph Agentic RAG 有界循环（P0~P10）的端到端实现与测试流程。

---

## 1. 目标 & 背景

### 1.1 旧版问题与痛点

1. **语义碎片化与截断幻觉**：旧版 RAG 仅做单层短分块（350 字符），会议纪要与需求文档在检索命中时上下文被严重截断，导致大模型回答“未找到详细说明”。
2. **多跳关联缺失**：跨实体（工单 → 提交 → 笔记 → 人员）查询全靠向量相似度，缺乏图谱结构化关系跳转，复杂问题召回率偏低（Naive RAG 多跳 P@5 仅 71.1%）。
3. **缺少自主纠错与有界闭环**：初次检索若证据不足（WEAK/INSUFFICIENT），系统无法自主根据正交子查询补全，或陷入无休止的 Agent 死循环。
4. **同名消歧与人员解析断层**：检索路由器无条件将所有查询发往非结构化检索，绕过了 `resolveUser` 的拼音/姓名拆解与 HIL（Human-in-the-Loop）人工选择卡片机制。

### 1.2 升级解决方案

- **PostgreSQL 原生图谱存储**：在 `pm` schema 中设计 `KnowledgeNode`、`KnowledgeEdge`、`KnowledgeNodeSource` 与 `KnowledgeCommunity` 4 张图模型，使用递归 CTE 实现 1~2 跳图谱遍历与 RRF（Reciprocal Rank Fusion, k=60）混合融合。
- **全链路检索路由器与安全降级**：实现 `STRUCTURED`、`HYBRID`、`GRAPH`、`WIKI`、`MIX` 五大路由通道，人员查询与状态统计走结构化通道，复杂复合问题走 MIX。
- **父子分层检索（Parent-Child Expansion）**：子块（350 字符）用于精确语义匹配，命中后自动向上回溯并扩展到完整父章节（2000 字符），兄弟块自动去重。
- **本地轻量级 Reranker（<15ms）**：综合标题精准匹配（0.45）、Jaccard 词重叠（0.35）、图谱/结构化先验与噪声惩罚（-0.35），零外部 API 依赖。
- **LLM Wiki 知识合成层**：动态基于项目数据模型合成全局架构与模块 Wiki，作为第四检索通道并保留原始溯源。
- **LangGraph Agentic RAG 有界循环（≤ 3 步）**：初次检索证据微弱时，自动利用正交子查询执行定向补全，步数严格受控于 3 步之内并安全收敛。

---

## 2. 改动清单

| 文件路径 | 改动类型 | 核心作用说明 |
| --- | --- | --- |
| `prisma/schema.prisma` | 修改 | 新增 4 个知识图谱模型与 14 个高性能索引（B-tree / GiST / Gin） |
| `features/knowledge/lib/graph/` | 新增 | 图谱业务同步、递归 CTE 检索、RRF 融合与 Sigma.js 可视化适配器 |
| `features/knowledge/lib/parent-child.ts` | 新增 | Markdown 章节切分、父子双层分块、动态回溯扩展与兄弟块去重 |
| `features/knowledge/lib/wiki/` | 新增 | LLM Wiki 知识层定义、动态项目 Wiki 合成与 WikiRetriever 通道 |
| `features/ai/search/query-understanding.ts` | 新增 | 12 类细粒度意图识别、数据库实体预解析与歧义度量化计算 |
| `features/ai/search/retrieval-router.ts` | 新增 | 五大检索路由标准化判定与失败自动安全降级至 Hybrid |
| `features/ai/search/reranker.ts` | 新增 | 本地毫秒级语义重排器（5 维信号打分与噪声抑制） |
| `features/ai/search/query-rewrite.ts` | 新增 | 单趟正则拼写纠错、领域别名归一化与 3 角度正交子查询生成 |
| `features/ai/search/rag-trace.ts` | 新增 | 全链路 RAG 追踪对象，记录初始 RRF Rank、重排分与链路决策 |
| `features/ai/search/evidence-evaluator.ts` | 新增 | 检索证据四态分类（SUFFICIENT/WEAK/INSUFFICIENT/AMBIGUOUS）与后置建议卡片生成 |
| `features/ai/search/planned-retrieval.ts` | 新增 | 规划化检索执行器，整合多通道召回、父子扩展与重排装配 |
| `features/ai/agents/conversation/nodes/retrieve-evidence.ts` | 新增 | LangGraph 检索证据节点，结合步数动态执行多轮补全 |
| `features/ai/agents/conversation/edges/routing.ts` | 修改 | 修复人员近况优先走结构化与 HIL，并实现有界步数控制（≤ 3 步） |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | 修改 | 支持新意图理解协议，扩充“负责了什么”等项目管理活动词 |
| `features/ai/core/resolvers/query-parser.ts` | 修改 | 增强人员近况识别正则，覆盖“负责/跟进”动词 |
| `features/ai/ui/ai-chat/AiChatPanel.tsx` | 修改 | 彻底修复 SSE 快照合并算法，杜绝多步循环时的 duplicate key 报错 |
| `features/ai/ui/ai-chat/AiThinkingStream.tsx` | 修改 | 防御性增加复合 key (`${task.id}-${idx}`) 消除 React 渲染警告 |
| `features/ai/ui/ai-chat/AiRightInspectorPanel.tsx` | 修改 | 新增“RAG Trace”专属监控面板，可视化排位反转与决策链路 |
| `scripts/benchmark-rag-eval.ts` | 新增 | P0 基准评测脚本，对比 Naive RAG 与 GraphRAG MIX |

---

## 3. 核心实现与关键逻辑

### 3.1 人员查询优先结构化与 HIL 消歧 (`features/ai/agents/conversation/edges/routing.ts`)

为防止通用 RAG 检索器劫持人员近况查询，在模型规划后优先将用户相关意图分流至 `searchStructured`：

```startLine:275:295:features/ai/agents/conversation/edges/routing.ts
  // Check if this is a person / user activity query that must go through searchStructured & resolveUser
  const isPersonQuery =
    state.queryType === "user" ||
    isUserActivityQuery(content) ||
    state.retrievalPlan?.fineGrainedIntent === "RECENT_ACTIVITY" ||
    state.retrievalPlan?.fineGrainedIntent === "TIMELINE";

  if (isPersonQuery) {
    return "searchStructured";
  }

  // If retrievalPlan is present:
  if (state.retrievalPlan) {
    const route = decideRetrievalRoute(state.retrievalPlan);
    if (route === "STRUCTURED") {
      return "searchStructured";
    }
    return "retrieveEvidence";
  }
```

**为什么这样写**：

- 人员查询（如“张工负责了什么”或“刘工在干什么”）必须调用 `resolveUser` 执行拼音解析（如将“张工”映射为 `Jing Zhang`）或多候选检测（如“刘工”匹配两位用户时触发 HIL 弹窗）；
- 只有真正的广义知识/多跳/技术问答才下发给 `retrieveEvidence`。

### 3.2 稳定有界循环编排 (`features/ai/agents/conversation/edges/routing.ts`)

在检索完成后的边路由中，严格限制自主重试步数在 3 步内，并精准对齐子查询索引：

```startLine:155:180:features/ai/agents/conversation/edges/routing.ts
  // 1. If sufficient or ambiguous, proceed to generateResponse immediately
  if (evalStatus === "SUFFICIENT" || evalStatus === "AMBIGUOUS") {
    return "generateResponse";
  }

  // 2. If weak or insufficient and we have remaining agentic steps (currentStep < maxAgenticSteps)
  if ((evalStatus === "WEAK" || evalStatus === "INSUFFICIENT") && currentStep < maxAgenticSteps) {
    const subQueries = state.retrievalPlan?.subQueries;
    const nextSubQueryIndex = currentStep - 1 >= 0 ? currentStep - 1 : 0;
    if (subQueries && subQueries.length > nextSubQueryIndex) {
      console.log(
        `[Agentic RAG] step ${currentStep}/${maxAgenticSteps}: re-routing with orthogonal sub-query for missing evidence: "${subQueries[nextSubQueryIndex]}"`,
      );
      return "retrieveEvidence";
    }
  }
```

**为什么这样写**：

- 消除 `currentStep` 与数组索引的偏移，第 1 轮初检返回 `WEAK` 时（`currentStep = 1`），正确使用第 1 个正交子查询（`subQueries[0]`）；
- 步数上限设为 3，彻底根绝死循环，保证有限轮次内确定性收敛至回答生成。

### 3.3 父子双层分块与动态扩展 (`features/knowledge/lib/parent-child.ts`)

```startLine:115:135:features/knowledge/lib/parent-child.ts
export function expandToParentSections(
  matchedChunks: SearchDocumentMatch[],
  allSections: MarkdownSection[],
): ExpandedContextResult {
  const seenSectionIds = new Set<string>();
  const expandedSections: MarkdownSection[] = [];
  const dedupedChunks: SearchDocumentMatch[] = [];

  for (const chunk of matchedChunks) {
    const parent = findEnclosingSection(chunk, allSections);
    if (parent && !seenSectionIds.has(parent.id)) {
      seenSectionIds.add(parent.id);
      expandedSections.push(parent);
      dedupedChunks.push(chunk);
    }
  }

  return { expandedSections, dedupedChunks };
}
```

**为什么这样写**：

- 检索以 350 字细粒度子 Chunk 为基础保证向量相似度的高敏度；
- 在上下文拼装阶段动态回溯所属的 2000 字完整章节并去重，使大模型阅读到连贯完整的技术方案。

---

## 4. 环境与配置

| 配置项 | 推荐值 | 说明 |
| --- | --- | --- |
| 服务端口 | `3003` | 本地开发与远程生产均绑定 `-H 0.0.0.0 -p 3003` |
| 数据库架构 | PostgreSQL 16 `pm` schema | 经由 `?options=-c search_path=pm,public` 访问，启用 `pgvector` 扩展 |
| 远程服务器 | `192.168.1.14` | 宿主 DB、Embedding API 与生产 Worker 所在地 |
| Node.js 版本 | `v20.x` / `v22.x` | Next.js 16 (Turbopack) 运行环境 |
| 默认模型 | `agnes:agnes-2.5-flash` | 系统默认对话与图谱语义抽取模型 |

---

## 5. 启动与验证命令

```bash
# 1. 切换到项目工作目录
cd /Volumes/WorkStation/project-manager

# 2. 安装/更新依赖
npm install

# 3. 运行本地开发服务器（绑定端口 3003）
npm run dev

# 4. 生产构建打包验证
npm run build
```

---

## 6. 测试 & 验证

### 6.1 自动化单元与集成测试（Vitest）

```bash
# 验证 P10 LangGraph Agentic RAG 有界循环与端到端状态图
npx vitest run features/ai/agents/conversation/agentic-rag.test.ts

# 验证 P8/P9 LLM Wiki 知识层与合成检索
npx vitest run features/knowledge/lib/wiki/wiki-retriever.test.ts

# 验证 P7 父子分层检索与无截断保证
npx vitest run features/knowledge/lib/parent-child.test.ts features/knowledge/lib/parent-child-llm.test.ts

# 验证 P3 本地毫秒级重排器
npx vitest run features/ai/search/reranker.test.ts

# 验证全量 AI 模块（44 个测试文件，285 项用例）
npx vitest run features/ai/
```

**期望输出**：

```text
 Test Files  44 passed (44)
      Tests  285 passed (285)
   Duration  ~5.5s
```

### 6.2 基准评测脚本（P0 Benchmark）

```bash
npx tsx scripts/benchmark-rag-eval.ts
```

**期望输出**：

```text
==================================================
📊 GraphRAG vs Naive RAG A/B Benchmark Results
==================================================
Total Questions Evaluated: 20
MIX Route Anchor Hit Rate: 100.0% (Naive: 95.0%)
MIX Route Path Recall: 100.0% (Naive: 94.7%)
Multi-hop Precision@5: 82.2% (Naive: 71.1%)
Status: Benchmark Succeeded!
```

---

## 7. 复现 Checklist

- [ ] 执行 `npx prisma db push` 确保数据库拥有 `KnowledgeNode` / `KnowledgeEdge` 等 4 张图表及 14 个索引
- [ ] 运行 `npx vitest run features/ai/` 确认 285 项测试全绿
- [ ] 运行 `npx tsx scripts/benchmark-rag-eval.ts` 确认 A/B 评测表现达标
- [ ] 启动 `npm run dev` 并在浏览器打开 `http://localhost:3003/ai`
- [ ] **测试“张工最近负责了什么？”**：确认控制台正确通过单字拼音匹配到 `Jing Zhang（123@qq.com）` 并输出其专长与近期工单
- [ ] **测试“刘工最近在干什么”**：确认页面弹出 CandidatePicker 卡片，列出 `cary（刘屹鹏）` 与 `刘屹鹏（user test）` 供选择，杜绝大模型猜测
- [ ] **测试“技术分享会纪要里关于 GraphRAG 实施方案的核心要点是什么？”**：确认返回完整章节内容，且思考流正常展示，控制台零 duplicate key 错误
- [ ] 运行 `npm run build` 确认生产打包成功（69 条路由编译通过，退出码为 0）

---

## 8. 踩坑记录

### 坑 1：React Virtual DOM 报 Duplicate Key `exec-...-9`

**现象**：
在长文档章节检索（如用例 2）触发多步自主回炉循环时，控制台抛出警告：

```text
Encountered two children with the same key, `exec-1788833057504-9`. 
Keys should be unique so that components maintain their identity across updates.
    at div
    at AiThinkingStream (features/ai/ui/ai-chat/AiThinkingStream.tsx:411:9)
```

**原因**：
在 `AiChatPanel.tsx` 处理后端 `timeline_snapshot` 事件时，旧版算法使用 `incomingByNodeOrLabel` 查找占位符并原地修改 `streamingTasksRef.current`。当 `retrieveEvidence` 节点因 Agentic 重试执行了多次时，旧任务与新任务的 ID 映射发生紊乱，导致已完成的真实任务被作为幽灵占位符二次插入，从而在 `TaskRecord[]` 中产生了两个相同的 ID。

**解法**：

1. 在 `AiChatPanel.tsx` 中引入 `initialPlaceholdersRef` 固化原始未执行占位符计划，快照更新时仅追加**真正尚未执行的未来节点**；
2. 每次快照合并后执行显式的 `Set<string>` 唯一性去重；
3. 在 `AiThinkingStream.tsx` 中将渲染 key 强化为 `key={`${task.id}-${idx}`}` 进行双重防御。

---

### 坑 2：人员查询与近况被全链路 RAG 路由器劫持，导致无法消歧与拼音识别

**现象**：
提问“张工最近负责了什么？”时，大模型无法匹配到 `Jing Zhang`；提问“刘工最近在干什么”时，系统明明匹配到两位候选人却不弹出选择卡片，而是大模型擅自判定为当前用户。

**原因**：
新路由器接入后，`routeAfterModelSelect` 中存在 `if (state.retrievalPlan) return "retrieveEvidence"`，导致由于意图理解模块生成了 `retrievalPlan`，所有查询被无差别劫持给 `retrieveEvidence`，绕过了原本具备完善拼音/姓名拆解与 HIL 决策的 `searchStructured` 节点。

**解法**：
在 `routing.ts` 的 `routeAfterModelSelect` 与 `routeByMode` 中，加入前置人员意图拦截器：
当 `queryType === "user"`、`isUserActivityQuery(content)` 或规划为 `RECENT_ACTIVITY` / `TIMELINE` 时，强制优先进入 `searchStructured`，走完 `resolveUser` → `decision` → `humanConfirmation` 完整链路。

---

### 坑 3：“负责”高频动词未收录导致活动意图识别降级

**现象**：
输入“刘工最近在干什么”能被识别为 `RECENT_ACTIVITY`，但“张工最近负责了什么？”却被判断为普通 `SEARCH`。

**原因**：
`query-parser.ts` 的 `isUserActivityQuery` 与 `query-understanding.ts` 的 `activityWords` 包含“干什么/做什么/提交什么”，但遗漏了“负责了什么/负责哪些/跟进什么”等项目协作高频动词。

**解法**：
在 `activityWords` 字典和正则匹配器中全面补全“负责/在负责/跟进”系列动词，保证各类人员职责与动态询问均被精准归类为 `RECENT_ACTIVITY`。
