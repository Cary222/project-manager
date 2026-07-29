# RAG 检索质量修复 — 从开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + 向量搜索）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**此次 RAG 修复的端到端过程。
> 修复 commit 范围：`1516ab7`（#10144）→ `50f90ff`（本次修复）

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

**问题 A：多 chunk 笔记只有 1 个能命中**

- `searchKeywordCandidates` 对同笔记的多个 chunk 按 `sourceId` 去重，只保留 1 个 score 最高的
- 若最高分的 chunk 不含用户答案（如答案在 chunk 2 而非 chunk 1），RAG 检索实际失效

**问题 B：中文整句查询无法召回**

- `splitTerms("光污染设计的需求里视场角是多少")` → `["光污染设计的需求里视场角是多少"]`（一个无空格的完整字符串）
- 无空格则无 tokenization，所有 keyword 匹配失败
- 同时 `buildSnippet` 截取在**首个 keyword 命中位置**（通常是 chunk 开头），若答案在 chunk 中段也被截掉

**问题 C：前端 UI 重复展示同一笔记的多个 chunk**

- 知识库搜索面板对同一笔记显示 3 个 chunk 条目（各带 `[1]`, `[2]`, `[3]` 编号）
- AI 对话 "参考来源" 也显示同一笔记 3 次

**问题 D：PKM chunk Snippet 被截到 800 字符**

- `buildSnippet` 对所有 sourceType 一刀切截到 800 chars（含中文），技术规格类 chunk 答案若在中部仍被隐藏

### 1.2 结论

- `mergeCandidates` 改为**不按 sourceId 去重**，让多个 chunk 并存，由 keywordScore 决定排序
- `splitTerms` 对纯中文单 token 启用 2-gram 分词，提取 `["光污染", "污染", "设计", "需求", "视场角", ...]`
- `buildSnippet` 改为锚定在**最后一个 keyword 命中位置**，而非第一个
- PKM note chunk 整段送入 snippet（不截断）
- 前端搜索面板 + AI 对话均按 URL 去重，展示 1 条而非 3 条

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/lib/search.ts` | 修改 | 核心检索逻辑：splitTerms 2-gram、buildSnippet 末位锚点、mergeCandidates 不去重、PKM 整段 snippet、rankDocument 中文 boost |
| `shared/lib/search-types.ts` | 修改 | 添加 `noteAttachmentCount` / `noteIndexedAttachmentCount` 字段透传到元数据 |
| `features/ai/lib/detector.ts` | 修改 | 扩展 `SEARCH_KEYWORDS` 增加"需求/设计/视场角/FOV/灵敏度..."等 spec 类关键词 |
| `features/ai/lib/rag.ts` | 修改 | prompt 里告诉 LLM 附件索引进度，避免 AI 说"我无法访问附件" |
| `features/ai/ui/AiMessageBubble.tsx` | 修改 | 前端按 URL 去重 AI 对话"参考来源"中的重复 chunk |
| `app/api/search/route.ts` | 修改 | 全局搜索 API 在返回前端前按 URL 去重（不影响 AI 侧的多 chunk 检索） |

---

## 3. 核心实现

### 3.1 `splitTerms` 中文 2-gram 分词（`shared/lib/search.ts`）

```96:115:shared/lib/search.ts
function splitTerms(query: string): string[] {
  const normalized = normalizeQuery(query);
  const tokens = normalized.split(" ").map((t) => t.trim()).filter(Boolean);

  // For a single Chinese token, use 2-gram so "光污染设计的需求里视场角" becomes
  // ["光污染", "污染", "设计", "需求", "视场角", ...] — each keyword hit gives +2
  // keyword score, so the chunk containing "光污染" + "设计" + "视场角" ranks highest.
  if (tokens.length === 1 && /[\u4e00-\u9fff]/.test(tokens[0])) {
    const word = tokens[0];
    const terms: string[] = [];
    // Walk through the string in 2-char steps, filtering out pure ASCII.
    for (let i = 0; i < word.length - 1; i++) {
      const term = word.slice(i, i + 2);
      if (/[\u4e00-\u9fff]{2}/.test(term)) terms.push(term);
    }
    return terms.slice(0, 6);
  }

  return tokens.slice(0, 6);
}
```

**为什么这样写**：中文没有天然空格分隔，若对 "光污染设计的需求里视场角" 直接做 keyword 匹配，所有 term 都会 miss（chunk 文本里是 "光污染" / "设计" / "视场角" 独立出现）。用 2-gram 提取所有相邻二字词，命中即给 +2 分，`["光污染","设计","视场角"]` 全中的 chunk 分最高。

---

### 3.2 `buildSnippet` 锚定末位命中（`shared/lib/search.ts`）

```160:179:shared/lib/search.ts
  // Use the *last* hit as the anchor. With queries like "光污染 视场角",
  // "光污染" matches near the top of the chunk but "视场角" matches in
  // the middle — and the middle one is where the user's answer lives.
  // Picking the last hit keeps both terms inside the snippet window.
  const hit = hits[hits.length - 1];
  const radius = Math.floor((SNIPPET_MAX_CHARS - 1) / 2);
  const start = Math.max(0, hit - radius);
  const end = Math.min(plain.length, start + SNIPPET_MAX_CHARS - 1);
  const snippet = plain.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < plain.length ? "…" : ""}`;
```

**为什么这样写**：多关键词查询（如"光污染 + 视场角"），第一个命中通常在 chunk 开头，但答案往往在中后段。改用 `hits[hits.length - 1]`（末位命中）作为锚点，保证关键词越集中的区域越居中。

---

### 3.3 `mergeCandidates` 不按 sourceId 去重（`shared/lib/search.ts`）

```1001:1032:shared/lib/search.ts
function mergeCandidates(options: {
  query: string;
  terms: string[];
  keywordDocuments: SearchDocumentRow[];
  vectorDocuments: VectorSearchRow[];
  viewerUserId?: string | null;
}) {
  // Each chunk is an independent candidate. Previously we deduped by
  // `${sourceType}:${sourceId}`, which meant a note with three chunks
  // could only contribute ONE chunk to the final ranked list — and if
  // that "winning" chunk didn't contain the answer, the user got nothing.
  // Now multiple chunks from the same note can appear, ranked by score;
  // the LLM treats them as different sections of the same document.
  const candidates: RankedCandidate[] = [];

  for (const document of options.keywordDocuments) {
    const keywordScore = rankDocument(document.title, document.content, options.terms, options.query);
    if (keywordScore <= 0 && !hasDirectQueryMatch(document.title, document.content, options.query)) {
      continue;
    }
    // ...
```

**为什么这样写**：旧版 dedup key 是 `${type}:${sourceId}`，同一笔记的所有 chunk 只保留一个。改为每个 chunk 独立参与排序后，AI 检索可以看到多个 chunk，由 LLM 决定引用哪一段。AI prompt 里写的是"引用第 N/M 段"，多 chunk 正好对应多段。

---

### 3.4 PKM note 整段作为 snippet（`shared/lib/search.ts`）

```968:977:shared/lib/search.ts
  // For PKM note chunks, use the full content as the snippet instead of cropping.
  // A chunk boundary is set at 1500 chars — the whole thing is a coherent section
  // of the document. Cropping it (even to 800 chars) risks hiding the answer that
  // the user is looking for if it happens to fall near the boundary.
  const useFullContent = args.document.sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE;
  const snippet = useFullContent
    ? args.document.content
    : buildSnippet(args.document.content, args.terms);
```

**为什么这样写**：Chunk 边界在 1500 chars，已是一个连贯段落。截到 800 chars 可能把答案（位于 1000-1400 区间）直接切掉。PKM note 的 chunk 保留全文，给 LLM 最完整的上下文。

---

### 3.5 前端按 URL 去重（`app/api/search/route.ts` + `features/ai/ui/AiMessageBubble.tsx`）

`app/api/search/route.ts` 对全局搜索面板：

```26:35:app/api/search/route.ts
    // Deduplicate results by (sourceType, sourceId) for the human-facing search panel.
    // searchDocuments returns every chunk independently so the AI can find the right
    // one — but showing three chunks of the same note in the UI is confusing.
    // Keep the highest-scoring chunk per source.
    const dedupedResults = (() => {
      const best = new Map<string, typeof data.results[0]>();
      for (const item of data.results) {
        const key = `${item.type}:${item.metadata?.projectId ?? ""}:${item.url}`;
        if (!best.has(key) || item.score > best.get(key)!.score) {
          best.set(key, item);
        }
      }
      return Array.from(best.values());
    })();
```

`features/ai/ui/AiMessageBubble.tsx` 对 AI 对话来源：

```31:39:features/ai/ui/AiMessageBubble.tsx
// Deduplicate sources by URL. The RAG retrieval returns each chunk of a note
// independently (so the LLM can pick the right slice), but to the user a
// three-chunk note should look like one source, not three.
// The first occurrence wins, since the backend serves them in score order.
function dedupeSourcesByUrl(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
```

**为什么这样写**：两处去重的目的不同——搜索面板保留最高分 chunk（用户看到摘要即可）；AI 对话让 LLM 看到全部 chunk（决策用），前端去重避免用户看到重复源。

---

### 3.6 RAG prompt 告知附件索引状态（`features/ai/lib/rag.ts`）

```37:47:features/ai/lib/rag.ts
      // Tell the LLM whether the note's attachments have been indexed yet.
      // Otherwise it falls back to "我无法访问附件" — which is technically
      // true but unhelpful: the user uploaded those attachments on purpose.
      if (result.type === "note" && (metadata.noteAttachmentCount ?? 0) > 0) {
        const total = metadata.noteAttachmentCount ?? 0;
        const indexed = metadata.noteIndexedAttachmentCount ?? 0;
        if (indexed < total) {
          lines.push(`附件状态：该笔记共 ${total} 个附件，已索引 ${indexed} 个（剩余 ${total - indexed} 个正在后台索引，约 1-2 分钟内可检索）`);
        } else if (indexed > 0) {
          lines.push(`附件状态：${total} 个附件已全部索引`);
        }
      }
```

**为什么这样写**：用户上传附件后若未完成索引，AI 会说"我无法访问附件"，造成困惑。新增元数据字段 `noteAttachmentCount` / `noteIndexedAttachmentCount`，让 LLM 知道"正在索引中，还需等待"而非"无法访问"。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `EMBEDDING_API_URL` | `http://192.168.1.14:5000` | Worker 上的 embedding 服务（向量检索用） |
| `DATABASE_URL` | PostgreSQL | Prisma 连接 |
| Worker | `systemd --user` 托管于 `hxy@192.168.1.14` | 服务名：`project-manager-worker` |
| Next.js 端口 | 3003 | 主应用端口 |
| Chunk 大小 | 1500 chars | PKM 笔记分块边界 |
| Snippet 最大 | 800 chars | 非 PKM source 的截断上限 |
| 中文 2-gram 上限 | 6 terms | `splitTerms` 对纯中文提取的最大词数 |

---

## 5. 启动 / 部署

### 5.1 Next.js 主应用

```bash
# 本地开发
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 远端生产（hxy@192.168.1.14）
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && git pull origin main && npm run build && systemctl --user restart project-manager-worker'
```

### 5.2 Worker 向量索引服务

```bash
# 查看状态
ssh hxy@192.168.1.14 'systemctl --user status project-manager-worker --no-pager | head -10'

# 查看日志
ssh hxy@192.168.1.14 'journalctl --user -u project-manager-worker --no-pager -n 20'
```

### 5.3 数据库变更（如有新增字段）

```bash
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && npx prisma db push'
```

---

## 6. 测试 & 验证

### 6.1 单元验证（关键词召回）

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsx -e "
const { searchDocuments } = require('./shared/lib/search');
(async () => {
  // 测试中文 2-gram 召回：含'光污染'+'视场角'的笔记 chunk
  const r = await searchDocuments({ query: '光污染设计的需求里视场角是多少', limit: 8, mode: 'search' });
  const notes = r.grouped.note;
  console.log('笔记命中数:', notes.length);
  notes.forEach((n, i) => {
    console.log(\`[\${i+1}] \${n.title} | score=\${n.score} | snippet=\${n.snippet?.slice(0,60)}...\`);
  });
})();
"
```

**期望输出**：命中 1 条笔记（如"光污染设计需求文档"），snippet 包含"视场角"和 ±15° 数值。

### 6.2 Worker 健康检查

```bash
ssh hxy@192.168.1.14 'systemctl --user status project-manager-worker --no-pager | head -5'
```

**期望输出**：`Active: active (running)`

### 6.3 队列索引进度

```bash
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && npx tsx scripts/check-pkm-index.ts 2>&1 | head -10'
```

**期望输出**：`COMPLETED` 队列有记录，无大量 `FAILED`。

### 6.4 AI 对话端到端

1. 浏览器打开 `http://localhost:3003`
2. 打开 AI 对话，问："光污染设计的需求里视场角是多少？"
3. 期望：AI 回答"±15°（全角约 30°）"并注明来源
4. 期望："参考来源"只显示 **1 条**该笔记（不再 3 条重复）

### 6.5 全局搜索面板端到端

1. 在项目内按 `Cmd+K`（或点击搜索框）
2. 输入"光污染 视场角"
3. 期望：知识库分区下该笔记只出现 **1 条**，snippet 包含"视场角：±15°"

---

## 7. 复现 Checklist

- [ ] 拉取最新 commit：`git pull origin main`
- [ ] 本地 `npm run dev` 启动 Next.js（端口 3003）
- [ ] `ssh hxy@192.168.1.14` 确认 worker 状态 `systemctl --user status project-manager-worker` 为 `active`
- [ ] 运行单元验证脚本（见 6.1），确认笔记命中
- [ ] 浏览器打开 AI 对话，问中文技术规格类问题，确认多 chunk 均被检索
- [ ] AI 对话"参考来源"去重验证：同一笔记只显示 1 条
- [ ] 全局搜索面板去重验证：同一笔记只显示 1 条
- [ ] 确认附件索引进度提示出现在 AI 回复中（对有附件但未完成索引的笔记）
- [ ] `git log --oneline -8` 确认 7 个修复 commit 均在 main 分支

---

## 8. 踩坑记录

### 坑 1：中文整句查询 100% 零召回

**现象**：`splitTerms` 对 "光污染设计的需求里视场角是多少" 返回 `["光污染设计的需求里视场角是多少"]`（1 个完整字符串），所有 keyword 匹配均 fail，RAG 返回空。

**原因**：中文没有天然空格，`split(" ")` 无法 tokenize。完整字符串在 chunk 内容中以独立词形式出现（"光污染"、"设计"、"视场角"），无法匹配。

**解法**：检测纯中文单 token 后，改为 2-gram 滑动窗口切分，提取所有相邻二字词，最多保留 6 个。

---

### 坑 2：多 chunk 笔记永远只有 1 个进入排序

**现象**：搜索"光污染设计的需求里视场角"，日志显示 PKM 索引有 3 个 chunk，但 API 只返回 1 条；AI 对话"参考来源"也只出现该笔记 1 次。

**原因**：`mergeCandidates` 在 2025 年改动时引入了 `${type}:${sourceId}` 去重 key，认为同一笔记只需一个 chunk。但 chunk 边界是固定的（1500 chars），答案可能恰好落在"非冠军"chunk 里。

**解法**：移除 sourceId 去重，每个 chunk 独立参与排序。AI prompt 里 "引用第 N/M 段" 的设计天然支持多 chunk（每 chunk = 1 段）。

---

### 坑 3：snippet 锚点在首个命中，答案在中段被截掉

**现象**：关键词 "光污染" 在 chunk 第 50 字处命中，"视场角" 在第 1000 字处命中。`buildSnippet` 锚定在 50，800-char 窗口只覆盖 50-850，答案是 1000+ 字，完全不在截取范围内。

**原因**：原逻辑 `hits[0]` 选首个命中，对多关键词查询（各命中在不同位置）不友好。

**解法**：改为 `hits[hits.length - 1]`（末位命中）作为锚点，两个关键词都落入窗口的概率更高。

---

### 坑 4：PKM note 的 chunk 答案被 800-char 截断隐藏

**现象**：即使解决了锚点问题，chunk 本身长度 1500 chars，答案在 900-1100 区间，`buildSnippet` 截到 800 仍会切掉。

**原因**：800-char 截断是针对 ticket/commit 等短内容设计的通用逻辑，对 PKM chunk 不适用——chunk 边界本身已由 Worker 设置为连贯段落。

**解法**：在 `toRankedCandidate` 里判断 `sourceType === PKM_NOTE`，直接用 `document.content` 整段作为 snippet，跳过 `buildSnippet`。

---

### 坑 5：AI 说"我无法访问附件"但用户明明上传了

**现象**：用户上传了 PDF 附件，AI 在对话中回复"我无法访问附件内容"，用户体验差。

**原因**：RAG prompt 里没有告知 LLM 附件的索引状态。LLM 看到的是纯文本 chunk（不含附件内容），默认推断"没有附件信息"。

**解法**：在 `rag.ts` 的 context 构建阶段，检查 `metadata.noteAttachmentCount > 0` 时注入"附件状态"行；同时 `search-types.ts` 新增 `noteAttachmentCount` / `noteIndexedAttachmentCount` 字段透传。

---

### 坑 6：前端 UI 搜索面板和 AI 对话各按不同 key 去重

**现象**：两者都按 URL 去重，但去重时机不同——搜索面板在后端 route 层去重（保留最高分 chunk），AI 对话在前端组件层去重（按 URL Set）。

**原因**：两处去重的语义需求不同：用户看搜索结果要简洁；AI 检索要完整 chunk（LLM 决策用），显示给用户时才去重。

**解法**：`app/api/search/route.ts` 用 `(type, projectId, url)` 三元组做 Map key；`AiMessageBubble.tsx` 用 URL Set 去重。去重 key 不同是**有意为之**，不是 bug。

---

### 坑 7：向量检索和关键词检索的 merge 边界问题

**现象**：`mergeCandidates` 对 keyword 和 vector 两路结果做合并，但两路都存在 chunk 级候选。

**原因**：`keywordDocuments` 已是分块后的行（每行 = 1 chunk），直接用 `document.content` 做 `rankDocument` 即可；不需要额外按 sourceId 合并。

**解法**：keyword 路径直接遍历每个 chunk；vector 路径遍历每个 chunk 的 `SearchResultItem`；两路独立排序后再合并。`rankDocument` 的评分在 chunk 粒度即可区分高下。
