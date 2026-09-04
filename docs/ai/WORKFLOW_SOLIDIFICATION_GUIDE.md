# ProjectHub 动态工作流固化机制与规范 (Workflow Solidification)

## 1. 背景与产品目标
在 ProjectHub Work 工作台中，用户通过受控 Coding 模式（`/plan`、`/goal`）完成某个业务工作流原型的验证后（如"提取客户反馈并归类"、"模块依赖分析周报"），系统可在任务最终预览界面提示：
> **“是否将此任务固化为固定工作流？”**

用户确认后，内置的 Pi Agent 依据标准脚手架（Procedural Skill: `scaffold-projecthub-workflow`）在后台完成代码搭建与安全验证，随后该工作流便会动态出现在 **GPT 欢迎页 (`AiWelcomeView`)** 的 Work 推荐卡片和 **`WorkDashboard`** 的工作流列表中。

## 2. 工作流核心分层架构

```
features/ai/
├── agents/work/
│   ├── workflows/
│   │   ├── registry.ts              # 集中注册中心（工作流 metadata、路由、参数校验）
│   │   ├── weekly-report/           # 示例：周报生成工作流
│   │   ├── meeting-minutes/         # 示例：会议纪要转录工作流
│   │   └── <custom-slug>/           # 🆕 动态固化的自定义工作流
│   │       ├── graph.ts             # LangGraph 状态图定义
│   │       ├── nodes/               # 处理节点
│   │       └── types.ts             # 状态与 Schema
│   └── runtime/
│       └── work-run-ref.ts          # 确定性路由与分诊匹配
└── ui/
    ├── ai-chat/
    │   └── AiWelcomeView.tsx        # 欢迎页 Work 模式快捷卡片呈现 (customWorkflows 插槽)
    └── ai-work/
        └── WorkDashboard.tsx        # 工作台任务执行与结果呈现
```

## 3. 固化触发与安全隔离守则

1. **零崩溃保证 (Zero Crash Guard)**：
   - 任何由 Agent 新增或修改的代码，必须先在隔离环境完成 TypeScript 语法检查与轻量单元测试。
   - 动态工作流采用 Try-Catch 与降级容错机制，单个工作流异常不波及全局会话。
2. **数据隔离守则**：
   - 严禁触碰 `public` schema 下的 community 公共表，业务状态持久化必须位于 `pm` schema 内。
3. **确定性优于黑盒执行**：
   - 固化后的工作流应为确定性 LangGraph 状态机，包含清晰的前置条件、状态迁移、输出产物（Artifact）及必要的人机审核节点（HIL）。
