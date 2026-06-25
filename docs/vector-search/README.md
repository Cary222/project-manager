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

## 管理 CLI

所有向量搜索管理功能统一通过 `search-admin.ts` 入口：

```bash
npm run search:status              # 查看 SearchDocument 统计 + 最近笔记
npm run search:backfill            # 全量回填（ticket + commit + note）
npm run search:backfill --types=note  # 仅回填 PKM 笔记
npm run search:reindex             # 重建所有 PKM 笔记（sync + embed）
npm run search:reindex --clear     # 重建前先清空旧数据
npm run search:reindex [noteId...] # 仅重建指定笔记
npm run search:embed               # 补充缺失向量（已有 content 无 vector 的行）
npm run search:clear               # 清空 PKM SearchDocument
npm run search:inspect [noteId]    # 查看 PKM SearchDocument 明细
npm run search:search <query>      # 测试搜索
npm run search:search <query> --viewer-user-id=xxx --limit=5
```

独立诊断脚本：

| 脚本 | 用途 |
|------|------|
| `diagnose-pkm-search.ts baseline` | 列出候选脏笔记（空 content、含图片/代码块） |
| `diagnose-pkm-search.ts measure <noteId> <term>` | 对比单条笔记改前改后搜索分数 |
| `test-clean-extracted-text.ts` | 验证附件提取文本清洗效果 |

## 环境变量

```bash
EMBEDDING_API_URL=http://192.168.1.14:5000   # 向量嵌入服务
SEARCH_EMBED_BATCH_SIZE=50                    # embed 批量大小
DATABASE_URL=postgresql://community:...        # pm schema
```

## 快速重建所有 PKM 笔记

```bash
# 先查看现状
npm run search:status

# 重建（先清空再回填）
npm run search:reindex --clear
```

## 相关文件

```
scripts/vector-search/search-admin.ts  # 统一管理 CLI
shared/lib/search.ts                   # 搜索核心逻辑
shared/lib/embedding.ts                # BGE-M3 调用 + fetchEmbeddingsBatch
shared/lib/search-types.ts             # 类型定义
prisma/schema.prisma                   # SearchDocument 模型
```
