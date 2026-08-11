---
name: AI Workflow 工作模式实施方案
overview: 在 features/ai/workflow/ 新建独立 Workflow Agent 层，与现有 Chat Agent 双层共存。第一版交付周报生成场景，长期支持通用定时任务 + 文件输出 + Scheduler + Postgres 持久化。
todos:
  - id: workflow-dir
    content: 确认 features/ai/workflow/ 目录结构与 Roadmap 双层架构对齐
    status: pending
  - id: workflow-state
    content: 设计 WorkflowStateAnnotation（独立于 Chat 的 AgentState）
    status: pending
  - id: weekly-graph
    content: 设计 weekly_report StateGraph：collectData → draft → waitReview → output
    status: pending
  - id: runtime
    content: 实现 MemorySaver Runtime 与 PostgresSaver 切换
    status: pending
  - id: scheduler
    content: 实现 Cron + 手动双触发 scheduler.ts（复用 jobs/background-jobs.ts）
    status: pending
  - id: interrupt
    content: 实现 waitReview 节点（LangGraph 原生 interrupt()）
    status: pending
  - id: api-route
    content: 实现 /api/ai/workflows/[id] 路由：start/status/resume
    status: pending
  - id: ui-status
    content: 实现 WorkflowStatus.tsx：状态卡片 + 审批按钮
    status: pending
  - id: schema-check
    content: 确认 weekly_reports 表结构 + 是否需新增 workflow_runs 表
    status: pending
isProject: false
---

# Plan: AI 工作模式（Workflow Agent）实施方案

## 决策结论

**目录选择**：`features/ai/workflow/` 新建独立子目录，不动 `features/ai/graph/`。

**理由**：

- **运行时本质不同**：现有 `graph/` 是 Stateless 单次 invoke（见 `features/ai/graph/agent.ts:222-229` 的 `agentGraph` 单例编译）；Workflow 需要 Stateful、`interrupt + resume`、Scheduler、Checkpointer
- **State 结构不同**：现有 `AgentStateAnnotation` 已有 16 个字段（`messages`/`mode`/`searchResults`/`pendingHumanAction` 等），强行塞入会让 Chat 对话延迟上涨
- **生命周期不同**：Chat 一次 `invoke()` 结束（秒级）；Workflow 可持续数小时到数天
- **贴合 Roadmap**：你已写的 `LangGraph-Architecture-Roadmap.md` 二.2.2 完整目标架构里明确规划了 `features/ai/chat/` + `features/ai/workflow/` 双层
- **避免架构债**：若塞进 `graph/` 当 mode，会污染现有 7 节点路由，且 Chat 链路会因 checkpointer 启动开销变慢

## 架构分层图

```
features/ai/
├── graph/                       # 现有：Chat Agent（Stateless）
│   ├── agent.ts                 # 单例编译的 7 节点图
│   ├── state.ts                 # AgentStateAnnotation
│   ├── nodes/
│   └── edges/
│
├── workflow/                    # 新增：Workflow Agent（Stateful）
│   ├── runtime.ts               # Checkpointer 切换（Memory/Postgres）
│   ├── scheduler.ts             # Cron + 用户手动触发统一入口
│   ├── approval.ts              # interrupt + resume 包装
│   ├── graphs/
│   │   ├── weekly-report.ts     # 周报生成（第一个落地场景）
│   │   └── _template.ts         # 通用模板（后续任务复用）
│   ├── state.ts                 # WorkflowState Annotation（独立）
│   ├── nodes/
│   │   ├── collect-data.ts      # 拉取工单/Commit/会议
│   │   ├── draft.ts             # 生成草稿
│   │   ├── wait-review.ts       # interrupt({prompt}) 等经理审
│   │   ├── revise.ts            # 根据反馈修改
│   │   └── output.ts            # 落盘到 weekly_reports 表 + 文件
│   ├── edges/
│   │   └── routing.ts           # 工作流路由
│   └── tools/
│       └── weekly-report-tools.ts  # 数据采集工具
│
├── jobs/                        # 现有：保留，scheduler.ts 调用
│   ├── background-jobs.ts
│   └── profile-cleanup.ts
│
└── (其他目录不变)
```

## 第一版交付：周报生成工作流（Stage 1）

### 范围

- 用户在 AI 对话界面说"帮我提交本周周报" → 进入工作模式
- 拉取本周工单 + Commit + 会议纪要 → 生成草稿 → interrupt 等经理审批 → 落盘

### 关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `features/ai/workflow/state.ts` | 新增 | `WorkflowStateAnnotation`，与 Chat 的 `AgentState` 完全独立 |
| `features/ai/workflow/graphs/weekly-report.ts` | 新增 | 周报工作流 `StateGraph` 组装 |
| `features/ai/workflow/nodes/collect-data.ts` | 新增 | 调用 `searchStructured` 拉数据 |
| `features/ai/workflow/nodes/draft.ts` | 新增 | LLM 生成周报草稿 |
| `features/ai/workflow/nodes/wait-review.ts` | 新增 | `interrupt()` 暂停等审批 |
| `features/ai/workflow/nodes/revise.ts` | 新增 | 根据经理反馈修改 |
| `features/ai/workflow/nodes/output.ts` | 新增 | 写入 `weekly_reports` 表 |
| `features/ai/workflow/edges/routing.ts` | 新增 | 工作流路由函数 |
| `features/ai/workflow/runtime.ts` | 新增 | Checkpointer 工厂（开发 Memory/生产 Postgres） |
| `features/ai/workflow/scheduler.ts` | 新增 | Cron + 手动触发统一入口 |
| `app/api/ai/workflows/[id]/route.ts` | 新增 | 启动/查询/resume 工作流的 API |
| `features/ai/ui/WorkflowStatus.tsx` | 新增 | 前端展示工作流状态 + 审批按钮 |

### 工作流时序

```
START
  ↓
collectData（拉工单+Commit+会议）
  ↓
draft（生成周报草稿）
  ↓
waitReview（interrupt，经理审）
  ↓
  ├─ 批准 → output（落盘）→ END
  ├─ 修改意见 → revise（重新生成）→ waitReview（再次 interrupt）
  └─ 取消 → END
```

### 学习映射

- `interrupt + resume` 用法 → 对应 Roadmap Week 4
- `MemorySaver`（开发） → 对应 Roadmap Week 7
- `Cron` 调度 → 对应 Roadmap `05-scheduler.ts`

## 长期演进路线（Stage 2+）

### Stage 2：持久化升级

- 复用现有 `pm` schema，添加 `workflow_runs` 表（存 thread_id + 状态 + 元数据）
- `runtime.ts` 切到 `PostgresSaver`（LangGraph 内置，无需新增依赖）
- 文件输出：复用现有的文件存储（项目里已有什么先看 `features/ai/store/`）

### Stage 3：通用任务模板

- `graphs/_template.ts` 抽象"拉数据 → 生成 → 审 → 输出"骨架
- 新增任务时只写：数据源 + 提示词 + 输出目标
- 类比：把 `POLICIES` 那张表升级成可配置的 Workflow 描述

### Stage 4：Cron 调度器

- `scheduler.ts` 接入 `node-cron` 或复用 `features/ai/jobs/`
- 支持用户配："每周五 17:00 自动生成周报"
- 调度任务本身入库，用户可暂停/恢复

## 与现有架构的边界

| 边界点 | Chat Agent（现有） | Workflow Agent（新增） |
|--------|-------------------|----------------------|
| State | `AgentStateAnnotation`（16 字段） | `WorkflowStateAnnotation`（独立） |
| Checkpointer | 无（Stateless） | 有（Memory/Postgres） |
| 中断机制 | 业务级 HIL（`pendingHumanAction` 字段自循环） | LangGraph 原生 `interrupt()` |
| 入口 | 用户发消息 | 用户提交任务 / Cron 触发 |
| 生命周期 | 单次 invoke，秒级 | thread_id 标识，小时/天级 |
| UI | SSE 流式输出 | 状态卡片 + 审批按钮 |

**关键澄清**：现有 `humanConfirmation` 节点用的是业务级 HIL（字段 + 自循环路由），**不是** LangGraph 原生 `interrupt()`。新 Workflow 会引入真正的 `interrupt()`，但和现有 HIL 共存无冲突——它们走不同的 State 字段和节点路径。

## 实施阶段建议

1. **Stage 1.1**：建 `workflow/state.ts` + `workflow/runtime.ts`（先 MemorySaver）+ `weekly-report.ts` 图，跑通手动触发
2. **Stage 1.2**：加 `waitReview` 节点（`interrupt()`）+ 前端 `WorkflowStatus.tsx`，跑通 resume
3. **Stage 1.3**：加 `scheduler.ts`（手动 + Cron），跑通定时周报
4. **Stage 2**：切 PostgresSaver + `workflow_runs` 表，跑生产化验证

每阶段结束跑 `npm run build` 和一个端到端 smoke 测试（手动触发周报 → interrupt → resume → 落盘）。

## 风险与权衡

- **风险 1**：`interrupt()` 跨进程恢复需要 checkpointer 持久化，开发期用 MemorySaver 上线即丢；必须 Stage 2 切 Postgres 才上生产
- **风险 2**：Cron 调度在 Next.js 进程内易被重启清掉；长期建议放独立 worker 或复用 `features/ai/jobs/` 已有的后台任务基础设施
- **风险 3**：周报生成涉及写 `weekly_reports` 表，需先确认现有表结构和权限（项目约束"勿改 community 公共表"，但 `weekly_reports` 是项目自身的表，应 OK）
- **收益**：一次性把 Roadmap Week 4-7 全部学完的场景真实落地，且为后续"AI 跟进项目进度""自动监控延期"等 Workflow Agent 应用铺好基础设施

## 暂未决定的细节（待 Stage 1.1 启动前确认）

1. `weekly_reports` 表的字段是否够用？是否需要加 `generated_by_workflow_run_id` 关联字段？
2. Scheduler 用 `node-cron`（进程内）还是接入现有 `features/ai/jobs/background-jobs.ts`？
3. Cron 表达式用户在哪配？要不要新建一个 `workflow_schedules` 表？

建议这三个问题先简单回答（推荐：1. 先看表再加字段；2. 复用 `background-jobs.ts`；3. 先放 `workflow_runs` 表的 `cron` 字段），再开始 Stage 1.1 编码。

## 改动摘要

| 阶段 | 文件数（新增） | 改动量 |
|------|---------------|--------|
| Stage 1.1 | 6 | 周报工作流 + Runtime |
| Stage 1.2 | 3 | interrupt + UI |
| Stage 1.3 | 1 | scheduler |
| Stage 2 | 3 | Postgres + workflow_runs 表 |

**总新增文件**：~13 个 .ts + 1 个 .tsx（不含可能的 schema 迁移）

---

**下一步**：等你确认这个方案。如果同意，我会按 Stage 1.1 → 1.2 → 1.3 → 2 顺序推进，每个 Stage 跑通后停下来让你验收再继续。

如果你想调整任何部分（比如想先做别的场景而不是周报，或者想合并 Stage），现在告诉我。