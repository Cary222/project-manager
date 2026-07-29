# shared/lib/ — 跨模块共享工具

本目录保留**真正跨模块共享**的工具类文件。业务逻辑文件已迁移到对应 feature。

## 目录结构

```
shared/lib/
├── README.md                    # 本文件
├── events/                     # 事件系统（跨模块）
│   └── ...
├── hash.ts                     # SHA256 哈希工具
├── health-cache.ts             # 健康检查缓存
├── markdown.ts                 # Markdown 解析/渲染
├── markdown.test.ts
├── permissions.ts              # 权限判断
├── permissions-client.ts        # 前端权限 hook
├── use-toast.ts                # Toast 通知 hook
└── visits-context.tsx          # 访问上下文 Provider
```

## 已迁移到 feature 的文件

| 原路径 | 新路径 | 对应 feature |
|--------|--------|--------------|
| `chunk.ts` / `chunk.test.ts` | `features/knowledge/lib/chunk.ts` | knowledge |
| `document.ts` / `document.test.ts` | `features/knowledge/lib/document.ts` | knowledge |
| `embedding.ts` | `features/knowledge/lib/embedding.ts` | knowledge |
| `file-reference.ts` | `features/knowledge/lib/file-reference.ts` | knowledge |
| `search-types.ts` | `features/knowledge/lib/search-types.ts` | knowledge |
| `search.ts` / `search.test.ts` | `features/knowledge/lib/search.ts` | knowledge |
| `upload.ts` | `features/knowledge/lib/upload.ts` | knowledge |
| `pkm.ts` | `features/knowledge/lib/pkm.ts` | knowledge |
| `user-search.ts` | `features/profile/lib/user-search.ts` | profile |
| `week.ts` | `features/weekly-reports/lib/week.ts` | weekly-reports |
| `jobs.ts` | `worker/lib/jobs.ts` | worker |

## 迁移原则

1. **业务逻辑文件** → 迁移到对应 `features/<module>/lib/`
2. **纯工具函数**（如 hash、markdown、permissions）→ 保留在 `shared/lib/`
3. **跨 feature 共用** → 保留在 `shared/lib/`
4. **Worker 相关** → 迁移到 `worker/lib/`

## 导入更新

迁移后如遇 import 错误，检查 import 路径是否需要更新：

```typescript
// 旧
import { searchDocuments } from "@/shared/lib/search";

// 新
import { searchDocuments } from "@/features/knowledge/lib/search";
```
