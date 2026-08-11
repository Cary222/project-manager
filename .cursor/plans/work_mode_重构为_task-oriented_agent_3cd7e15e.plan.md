---
name: Work Mode 重构为 Task-Oriented Agent
overview: features/ai/ 目录重构完成。已按目标架构迁移所有文件，删除了所有废弃目录。
todos:
  - id: phase1-runtime
    content: "Phase 1: Runtime 基础设施"
    status: completed
  - id: phase2-work-graph
    content: "Phase 2: Work Agent Graph"
    status: completed
  - id: phase3-scheduler
    content: "Phase 3: Scheduler 集成"
    status: completed
  - id: phase4-cleanup
    content: "Phase 4: 目录清理"
    status: completed
isProject: false
completedDate: 2026-08-04
---

## 最终架构

```
features/ai/
├── runtime/                          ✅ 新增（不含业务）
│   ├── types.ts
│   ├── events.ts
│   ├── checkpointer.ts
│   ├── tool-registry.ts
│   ├── state.ts
│   ├── scheduler.ts
│   ├── planner/
│   │   ├── planner.ts
│   │   ├── dynamic-executor.ts
│   │   └── index.ts
│   └── index.ts
│
├── agents/
│   ├── conversation/                ✅ 重命名（原 graph/）
│   │   ├── agent.ts
│   │   ├── state.ts
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── index.ts
│   │   ├── edges/routing.ts
│   │   └── nodes/
│   │
│   └── work/                       ✅ 新增
│       ├── graph.ts
│       ├── runtime/
│       │   ├── planner.ts
│       │   ├── approval.ts
│       │   ├── lifecycle.ts
│       │   └── index.ts
│       ├── workflows/
│       │   ├── registry.ts
│       │   └── weekly-report/
│       │       ├── state.ts
│       │       ├── graph.ts
│       │       ├── approval.ts
│       │       ├── checkpointer.ts
│       │       ├── _template.ts
│       │       ├── edges/routing.ts
│       │       ├── nodes/
│       │       │   ├── collect-data.ts
│       │       │   ├── draft.ts
│       │       │   ├── wait-review.ts
│       │       │   ├── revise.ts
│       │       │   └── output.ts
│       │       └── tools/
│       │           └── weekly-report-tools.ts
│       └── tools/
│           ├── read-resource.ts
│           ├── write-file.ts
│           ├── edit-file.ts
│           └── execute-command.ts
│
├── core/                            ✅ 不动
├── tools/                           ✅ 不动
├── llm/                             ✅ 不动
├── types/                           ✅ 不动
├── lib/                             ✅ 不动
├── jobs/                            ✅ 不动
├── store/                           ✅ 不动
├── search/                          ✅ 不动
└── ui/
    ├── work/                        ✅ 新增
    └── (其余 AiChat*.tsx)           ✅ 不动

app/api/ai/
├── conversations/                    ✅ 不动
└── workflows/                      ✅ 重排
    ├── route.ts
    └── [id]/route.ts
```

---

## 已删除目录

| 目录 | 原位置 |
|------|--------|
| `pi-core/` | 参考代码 |
| `work-mode/` | 重复实现 |
| `workflow/` | 已迁移到 `agents/work/workflows/weekly-report/` |
| `graph/` | 已迁移到 `agents/conversation/` |

---

## 验证结果

- ✅ 无断裂引用（`@/features/ai/workflow`、`@/features/ai/graph` 等）
- ✅ `npm run dev` 启动成功
- ✅ `/ai` 页面返回 307（正常重定向）
- ✅ 所有 API routes 引用已更新

---

## 备注

1. `Prisma/AgentRun` model 未添加（Phase 1 保持 `WorkflowRun`）
2. `workflow/tools/weekly-report-tools.ts` 已重建为 `agents/work/workflows/weekly-report/tools/weekly-report-tools.ts`
3. Work-mode API routes 已删除（如需恢复，参考 git 历史）
