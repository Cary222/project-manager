# 向量搜索管理 & 诊断脚本

跑向量搜索相关的运维命令、诊断和回归测试。**全部是一次性脚本**（不是常驻服务）——常驻服务见 `worker/`。

## 管理 CLI

### `search-admin.ts` — 索引 & 搜索管理

```bash
npm run search:status        # 各 sourceType 的 SearchDocument / embedding 数量
npm run search:backfill      # 批量重建 ticket / commit / note 索引（同步执行，阻塞）
npm run search:reindex [--clear] [noteId...]   # 重索引笔记（带 PDF 解析，向量立即生成）
npm run search:embed         # 补全所有 SearchDocument 中 embedding IS NULL 的（在线调用 embedding 服务）
npm run search:clear -- --types=note           # 清空指定类型的 SearchDocument
npm run search:inspect [noteId]                # 查看某 note 的 SearchDocument chunk + embedding 状态
npm run search:search "query" [--limit=10]     # 直接调 /api/search 同样的检索逻辑
```

### `job-admin.ts` — IndexJob 队列管理

> IndexJob 是异步索引流水线的任务表（详见 `worker/README.md`）。

```bash
npm run job:status                              # pending/processing/completed/failed 计数
npm run job:inspect <noteId>                    # 某 note 的最近 10 个 jobs
npm run job:retry <jobId>                       # 重置单个失败 job 到 PENDING
npm run job:retry-note <noteId>                 # 重置某 note 的所有失败 job
npm run job:clear-pending                       # 清空所有 PENDING（慎用）
npm run job:purge -- --older-than-days=7        # 清理老的 COMPLETED
```

## 诊断 & 回归测试

### `diagnose-pkm-search.ts` — PKM 搜索效果诊断

```bash
npx tsx scripts/vector-search/diagnose-pkm-search.ts baseline    # 记录当前 N 个关键词的命中率
npx tsx scripts/vector-search/diagnose-pkm-search.ts measure     # 对比一次 measure 之后的指标变化
```

用于评估"调整 chunking 策略 / embedding 模型 / 清洗规则"前后的搜索效果。

### `test-clean-extracted-text.ts` — 附件文本清洗效果调试

```bash
npx tsx scripts/vector-search/test-clean-extracted-text.ts
```

从 DB 捞所有含附件的 PKM 笔记，对每个附件：
1. 调 `embedding:5000/extract-text` 拿原始文本
2. 调 `cleanExtractedTextForEmbedding` 看清洗结果
3. 打印 before/after 对比 + size 变化

用于调 markdown 清洗规则时验证效果。

## 相关文档

- `docs/vector-search/PKM异步索引改造-详细计划.md` — 异步索引架构
- `docs/vector-search/PKM异步索引改造-进度追踪.md` — 进度
- `docs/vector-search/向量搜索-静默失败修复.md` — 历史 bug 修复
- `docs/vector-search/VECTOR_SEARCH_TROUBLESHOOT.md` — 故障排查
- `docs/vector-search/PKM_SEARCH_CLEANING.md` — 文本清洗
- `docs/vector-search/PKM_CHUNKING_IMPL.md` — chunk 切分实现
