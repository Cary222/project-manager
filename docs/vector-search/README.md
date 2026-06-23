# 向量搜索

PKM 笔记 + 工单 + 提交 的 BGE-M3 向量搜索实现，支持 chunking 长文本、keyword+vector 双通道混合检索、跨类型结果聚合。

## 文档

| 文件 | 内容 |
|------|------|
| `向量搜索-静默失败修复.md` | embedding 超长文本静默失败的问题定位与修复 |
| `向量搜索-静默失败修复.md` | searchDocuments 返回 0 条（metadata NULL 导致权限过滤静默丢弃） |
| `PKM_SEARCH_CLEANING.md` | 搜索文本清洗逻辑（去水印、空格等） |
| `PKM_CHUNKING_IMPL.md` | Chunking 分块策略与聚合搜索实现 |
| `VECTOR_SEARCH_TROUBLESHOOT.md` | 向量搜索故障排查指南 |
| `ATTACHMENT_TEXT_EXTRACTION.md` | PDF/PPTX/文本/DOCX 附件提取到搜索文档的完整流程 |
| `DOCX_EXTRACT.md` | DOCX 附件提取开发测试复现手册（服务器部署 + 验证） |

## 脚本

| 脚本 | 用途 |
|------|------|
| `reindex-pkm-notes.ts` | 批量重建 PKM 笔记搜索文档（sync + embed） |
| `backfill-search-embeddings.ts` | 补充缺失向量的文档重新嵌入 |
| `backfill-search-index.ts` | 全量回填 Git commit → SearchDocument |
| `clear-pkm-search-documents.ts` | 清除所有 PKM 搜索文档（重建前清理） |
| `diagnose-pkm-search.ts` | 诊断搜索数据脏乱问题（空 content、重复等） |
| `debug-vector-search.ts` | 调试向量搜索：query → embedding → 邻近检索 |
| `inspect-search-doc.ts` | 快速查看某笔记的搜索文档详情 |
| `test-clean-extracted-text.ts` | 验证附件提取文本的清洗效果 |

## 环境变量

```bash
EMBEDDING_API_URL=http://192.168.1.14:5000   # 向量嵌入服务
SEARCH_EMBED_BATCH_SIZE=50                    # backfill 批量大小
DATABASE_URL=postgresql://community:...        # pm schema
```

## 快速重建所有 PKM 笔记

```bash
# 1. 清除旧数据
DATABASE_URL="..." npx tsx scripts/vector-search/clear-pkm-search-documents.ts

# 2. 重建（20篇/批，1并发）
DATABASE_URL="..." EMBEDDING_API_URL="..." npx tsx scripts/vector-search/reindex-pkm-notes.ts
```

## 相关文件

```
shared/lib/search.ts          # 搜索核心逻辑
shared/lib/embedding.ts       # BGE-M3 调用 + fetchEmbeddingsBatch
shared/lib/search-types.ts    # 类型定义
prisma/schema.prisma          # SearchDocument 模型
```
