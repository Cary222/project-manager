# AiChat、Work Mode 与 Global Mode Router 联合架构重构（#10043）复现手册

> 适用：project-manager 仓库（Next.js 16 + Prisma + LangGraph + AI SDK 3.x）  
> 目标：完整记录 #10043 涉及的 Global Mode Router 产品级模式分流器、AiChat 意图分诊语义化、被动实体对齐（Passive Entity Grounding）、消歧门禁收紧（Task-Blocking Ambiguity）、Chat → Work 非侵入式平滑 Handoff、末尾建议动作芯片（SuggestedAction），以及 Shared AI Core 基础设施下沉全貌。

---

## 1. 目标与背景

### 1.1 核心痛点与历史缺陷

1. **用户心智负担重**：
   - 欢迎页存在生硬的“对话 / 工作”人工 Tab 切换，用户必须先理解底层产品边界，才能发起请求；
2. **AiChat 控制权严重错位（“你好”弹 4 个人名）**：
   - 旧版 `detectIntent` 依赖百行硬编码排除词和脆弱正则；
   - `parseQueryType` 内含贪婪正则 `/(?:帮我|请问|找|查|看)\s*[\u4e00-\u9fa5]{1,30}/` 强判为查用户；
   - `extractUserIdentifier` 漏掉了“你好”，将“你好”提取为人名，导致 `resolveUser` 拆拼音 `["ni", "hao"]` 并在数据库模糊命中“秦子轩、许敏捷、俞闵婕、谢上鹏”4 人；
   - `decisionNode` 只要 `candidates > 1` 就无脑强行打断流式问答，弹出人名消歧卡片，严重破坏基础问答体验。
3. **老代码在“理解阶段”强行打断会话（假死空白 Bug）**：
   - 在 Chat 模式中输入“我要写周报”时，旧版 `detectIntent` 只要命中工作流关键词，就强行返回 `waitingForConfirmation: true`、`pendingHumanAction: { type: "approve" }` 并清空 `retrievalPlan`；
   - 后端 `messages/route.ts` 误将其视作等待下一轮选择实体的 HIL 状态，直接执行 `closeStream(); return;` 强杀连接；
   - 前端 `skipAssistantMessageRef` 同时将整条回复过滤，导致用户看到 AI“正在思考...理解意图”推演完毕后直接关闭连接，界面一片空白死寂。
4. **底层能力重复建设与孤岛代码残留**：
   - Work 独享一套 `business-query.ts`，Chat 独享一套 `core/queries/`；
   - 存在历史孤岛目录 `features/ai/integrations/pi-extension/`（未被任何代码引用的死代码），绕过了数据权限校验。

### 1.2 联合重构原则

> **“尽善尽美，但物尽其用。最大化复用现有已经正确工作的代码，只重构错误的控制关系；让 Chat 与 Work 强相关、共享基础设施，但保持各自清晰的 Runtime 职责。”**
>
> 核心原则：  
> `Chat = Answer Runtime（理解 → 检索/查询 → 分析 → 完整回答）`  
> `Work = Goal Execution Runtime（理解 → 策略 → Workflow/Planner → 审批 → CAS 执行 → 评估）`  
> `共享底层能力，不共享 Runtime；LLM 负责语义决策，确定性代码负责 Grounding、权限、执行与安全。`

---

## 2. 核心架构全景（To-Be Target）

```text
                                用户输入 (WelcomeView / Chat / Work)
                                                │
                                                ▼
                                   Input Preprocessor (纯事实提取)
                               显式 @人名 / #工单 / URL / 附件 / 当前 PageContext
                                                │
                                                ▼
                                    Global Mode Router (轻量分流)
                          判断目标：想知道什么 (Chat) 还是 想完成什么 (Work)
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 │ (route: "chat" | "stay_current")                            │ (route: "work" | "chat_then_offer_work")
                 ▼                                                             ▼
┌───────────────────────────────────────────────┐             ┌───────────────────────────────────────────────┐
│            AiChat: Answer Runtime             │             │         Work: Goal Execution Runtime          │
│                (基于 LangGraph)               │             │            (基于 Work Orchestrator)           │
├───────────────────────────────────────────────┤             ├───────────────────────────────────────────────┤
│ 1. decideChatRoute (微型分类器):              │             │ 1. Preprocessor: isCodingTask 降级为 hint     │
│    direct / retrieve / structured / mixed     │             │ 2. decideWorkStrategy (策略决策器):           │
│ 2. Passive Entity Grounding (被动对齐):       │             │    direct / clarify / workflow / planner      │
│    仅对决策声明的实体执行数据库对齐与排序     │             │ 3. Workflow Registry (已验证 Plan Template):  │
│ 3. Retrieval Plan 结构化展开 (Hybrid/Graph)   │             │    weekly_report, project_progress, meeting   │
│ 4. Task-Blocking HIL (消歧收紧):              │             │ 4. Critic 严格白名单、无环性与 Zod 校验       │
│    仅在任务强阻塞且无高置信赢家时弹窗         │             │ 5. Plan Approval & Action Approval 分层审批   │
│ 5. Generate Response (流式响应):              │             │ 6. executeApprovedPlan (CAS 乐观锁幂等执行)   │
│    动态模型、Thinking 步骤、多模态支持        │             │ 7. Evaluator 质检裁判:                         │
│ 6. SuggestedAction[] 生成 (Next Action):      │             │    done / incomplete / blocked                │
│    [生成周报] [进入Work整理纪要] [深入归因]   │             │    (incomplete + recoverable ──► 自动 Replan) │
└───────────────────────┬───────────────────────┘             └───────────────────────────────────────────────┘
                        │                                                              ▲
                        │                   Chat → Work Handoff                        │
                        └───────── (无侵入提示卡片，携带上下文/工单/会话ID平滑切入) ────────┘
```

---

## 3. 核心改动清单

| 文件 | 改动类型 | 核心作用与职责 |
| :--- | :---: | :--- |
| `features/ai/routing/global-mode-router.ts` | **新建** | Global Mode Router 服务端决策器：0ms 问候快路径 + 1.2s Flash 模型意图分流 |
| `features/ai/routing/types.ts` | **新建** | 定义 `ModeDecision`、`GoalType`、`GlobalRouterContext` 严格 Zod 契约 |
| `app/api/ai/routing/mode/route.ts` | **新建** | 暴露 `POST /api/ai/routing/mode` API，供欢迎页与多端调用 |
| `features/ai/ui/ai-chat/AiWelcomeView.tsx` | **修改** | 欢迎页中立分流：根据 Global Router 自动选择启动 Chat 或预填启动 Work |
| `features/ai/agents/conversation/router/decision.ts` | **新建** | Chat 轻量级语义决策器 `decideChatRoute`，输出模式、所需能力与声明实体 |
| `features/ai/core/entities/grounding.ts` | **新建** | 被动实体对齐层（Passive Grounding）与 `isAmbiguityTaskBlocking` 阻塞性判定 |
| `features/ai/core/resolvers/query-parser.ts` | **修改** | 废除“帮我/请问”强制判查人规则；增加 `COMMON_NON_NAMES`，问候语 0ms 拦截 |
| `features/ai/core/resolvers/user-resolver.ts` | **修改** | 增加问候语及非人名短路防线，禁止对问候语查库或拆拼音 |
| `features/ai/agents/conversation/nodes/decision.ts` | **修改** | 收紧消歧门限：单候选自动采信，仅在强阻塞且无赢家时触发 HIL，非阻塞不打断 |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | **修改** | 接入 `decideChatRoute`；废除工作流意图在第一步拦截会话图的旧逻辑 |
| `features/ai/agents/conversation/nodes/generate-response.ts` | **修改** | 废除伪文本早退短路，生成真实回答；在末尾自决注入 `suggestedActions` |
| `features/ai/agents/conversation/edges/routing.ts` | **修改** | 调整路由跳转顺序，非搜索模式直通响应，工作流意图不再死循环拦截 |
| `features/ai/handoff/suggested-actions.ts` | **新建** | 动作推荐引擎：全量覆盖周报、大盘、会议纪要、代码修复，支持内容语义自决 |
| `features/ai/handoff/handoff-contract.ts` | **新建** | 定义 `ChatToWorkHandoffPayload` 及其序列化/反序列化契约 |
| `features/ai/ui/ai-chat/AiChatPanel.tsx` | **修改** | 移除消息过滤与跳过逻辑；气泡底部渲染交互芯片；点击携带会话 ID 切入 Work |
| `features/ai/ui/ai-chat/AiChatPage.tsx` | **修改** | 切换 Work 时保留 `c: conversationId` 与项目/工单参数，实现上下文继承 |
| `features/ai/core/capability-registry.ts` | **新建** | 统一单一真相源能力目录，收敛 10 项能力 Schema、副作用与风险等级 |
| `features/ai/core/context/context-resolver.ts` | **新建** | 全系统统一上下文解析器：`currentUser`, `dataScope`, `explicitMentions` |
| `features/ai/core/policy/data-scope.ts` | **新建** | 下沉 `resolveDataScope` 确定性权限策略，为双链路提供强隔离约束 |
| `features/ai/core/time-window.ts` | **新建** | 下沉统一时区 `WORK_TIMEZONE`（Asia/Shanghai）与自然月毫秒计算 |
| `features/ai/core/queries/query-ticket.ts` | **修改** | 强制接入 `resolveDataScope()`，单查与列表均校验项目可见性 |
| `features/ai/core/queries/query-project.ts` | **修改** | 强制接入 `resolveDataScope()`，限制非 ROOT 用户只能访问成员项目 |
| `features/ai/agents/work/planner/evaluator.ts` | **修改** | 扩充 Evaluator 状态 `done / incomplete / blocked` |
| `features/ai/agents/work/planner/execute.ts` | **修改** | Evaluator 判为 `incomplete` 且在预算内时，自动触发 `origin: "replan"` 重规划 |
| `features/ai/agents/work/workflows/registry.ts` | **修改** | 工作流升级为声明式 `WorkflowDefinition`（已验证 Plan Template） |
| `features/ai/agents/work/graph.ts` | **修改** | `isCodingTask` 降权为 `codingHint`，执行权收敛至 Work 决策器 |
| `features/ai/pi-integration/index.ts` | **新建** | 明确 Pi Runtime 纯 Bridge 架构边界；删除 0 引用的 `pi-extension` 孤岛 |

---

## 4. 关键机制实现与闭环细节

### 4.1 Global Mode Router 架构定位与中立网关

Global Router 是产品级的总门禁：

- **欢迎页（WelcomeView）**：
  - 用户输入目标（如“我要写周报”或“修改 #10208 代码”）；
  - 前端异步请求 `/api/ai/routing/mode`，服务端判断其为 `actionable` / `transactional`；
  - 欢迎页自动带入目标切换到 Work 模式并就绪，**用户不再需要理解“对话”与“工作”Tab 的区别**；
  - 若输入为“你好”或“#10208 是什么”，则自动以 Chat 模式开启对话。
- **对话中（In-Chat）**：
  - 保持克制，不强行将正在浏览历史的用户跳转打断；
  - 允许 Chat 链路完整作答，在回答末尾提供优雅平滑的直达芯片。

### 4.2 彻底根治“你好”弹人名与消歧滥用

- **前端剔除**：`COMMON_NON_NAMES` 字典包含常见问候词（你好/您好/在吗/谢谢/好的/再见）与口语助词，`extractUserIdentifier` 在输入开头与清洗后直接返回 `undefined`；
- **正则剔除**：删除了 `parseQueryType` 里一见“帮我/请问”就强判用户的危险正则；
- **底层短路**：`resolveUser` 增加非人名正则短路守卫，命中问候词立即返回 `{ user: null, confidence: 0 }`，**绝不查库，绝不拆拼音**；
- **消歧收紧**：在 `decision.ts` 中规定：只有在 `isTaskBlocking`（查个人活动/周报等必须明确唯一人选的任务）且无高置信赢家且候选数在 2~6 人时才触发 HIL，非阻塞场景一律放行。

### 4.3 彻底根治“我要写周报”在理解阶段打断的假死 Bug

- **放行执行图**：在 `detectIntent` 中识别到工作流时，仅记录 `state.workflowMatch`，不再设置 `waitingForConfirmation: true`，不中断会话图；
- **大模型真实回答**：删除 `generateResponseNode` 开头的 `[WORKFLOW_MATCH:...]` 伪文本短路，大模型正常输出周报撰写指引与历史参考；
- **对话结尾闭环推荐（SuggestedAction）**：
  - 在大模型生成完毕后，自动在对话结尾呈现动作芯片：
    `[⚡ 进入 Work 模式：周报生成]`；
  - 支持多场景自决：发“我要记录会议纪要”，AI 生成纪要指引后，末尾精准提供 `[🎙️ 进入 Work 模式：会议纪要整理]` 与 `[📝 在对话中直接补充会议要点]`。

### 4.4 Chat → Work Handoff 授权上下文继承

- 过去从 Chat 切到 Work 会执行 `params.delete("c")`，导致会话上下文丢失；
- 重构后：点击 SuggestedAction 芯片时，通过 `serializeHandoffParams` 将 `conversationId`、`projectId`、`ticketId` 完整编码在 URL 参数中；
- Work 端接收后，根据 `conversationId` 在服务端重新绑定授权范围，并在左侧会话历史中实时同步推进，无需从前端拷贝冗长历史文本。

### 4.5 Work 闭环与 Evaluator 自适应重规划

- Evaluator 输出判定细化为 `done`、`incomplete`、`blocked`、`replan`、`needs_human`、`failed`；
- 在步骤执行完毕后，如果目标核心诉求未达成（例如缺少关键依赖数据），Evaluator 返回 `incomplete`；
- 执行器结合当前重规划预算（`canReplan(replanCount, maxReplans)`），**自动触发 `planForRun` 生成 Plan vN+1 并请求审批**，真正实现 `Step Completion != Goal Completion`。

---

## 5. 验证与测试报告

### 5.1 全局类型检查与自动化单元测试

- **TypeScript 类型检查**：

  ```bash
  npx tsc --noEmit
  # 输出: TSC_OK / TSC_ALL_CLEAN (0 errors)
  ```

- **全量 AI 核心套件测试**：

  ```bash
  npx vitest run features/ai/
  # 测试结果: 61 个测试套件，413 个用例 100% 全部通过 (413 passed, 0 failed)
  ```

| 专项测试套件 | 验证范围 | 状态 |
| :--- | :--- | :---: |
| `global-mode-router.test.ts` | 验证欢迎页问候直通、问题分流、工作流交付物感知、Chat 保守策略 | ✅ 通过 |
| `context-resolver.test.ts` | 验证 `@人名`、`#工单` 提取与 `dataScope` 越界置空安全保障 | ✅ 通过 |
| `grounding.test.ts` | 验证被动实体对齐、得分领先赢家自决、非阻塞歧义不打断 | ✅ 通过 |
| `greeting-no-hil.test.ts` | 验证“你好/在吗/谢谢”在全链路均返回 `undefined`，候选数为 0 | ✅ 通过 |
| `workflow-dialog-pipeline.test.ts` | 验证“我要写周报”在 Chat 模式不被打断，生成真实回复并在末尾下发芯片 | ✅ 通过 |
| `suggested-actions.test.ts` | 验证周报、项目大盘、会议纪要、代码修复及深入归因的推荐生成 | ✅ 通过 |
| `handoff-contract.test.ts` | 验证 Handoff 数据包序列化与反序列化，参数 100% 还原 | ✅ 通过 |
| `capability-registry.test.ts` | 验证统一能力目录的 Schema、副作用标记、风险等级与可用环境 | ✅ 通过 |
| `pi-integration-boundary.test.ts` | 验证 Pi 集成目录仅限 Bridge 职责，杜绝第三方业务工具层 | ✅ 通过 |
| Work Orchestrator 既有测试 | 验证 CAS 状态机、Critic 校验、拓扑执行与 Evaluator 逻辑无损 | ✅ 通过 |

### 5.2 真实浏览器（Agent Browser）实测验证

使用正式测试账号 `2428058380@qq.com`（管理员）在本地环境实测：

1. **基础打招呼**：输入“你好”，AI 正常回复自我介绍，无拼音查库，无消歧弹窗；
2. **欢迎页直接输入“我要写周报”**：无需手动切换 Tab，Global Router 自动感知为 Work 模式并携目标进入；
3. **Chat 对话中输入“我要写周报”**：AI 思考推演完整走通，输出结构化撰写建议，对话结尾渲染 `[⚡ 生成本周周报]` 芯片；
4. **Chat 对话中输入“我要记录会议纪要”**：AI 输出 6 步推演与纪要模板，对话结尾同时渲染 `[🎙️ 进入 Work 模式：会议纪要整理]` 与 `[📝 在对话中直接补充会议要点]` 芯片；
5. **点击跳转芯片**：瞬间切入 Work 工作台，URL 为 `http://localhost:3003/ai?c=cmu0p8i5s001z1j73x3r40xso&m=work&goal=进入 Work 模式：会议纪要整理&route=meeting_minutes`，原会话 ID 完整保留，目标与工作流自动载入。

---

## 6. 总结

本轮重构严格按照工单 #10043 既定目标执行，不仅消除了长期积弊的问候弹人名和会话假死打断 Bug，更建立了标准的 **Global Mode Router + Chat/Work 双链路分流 + Shared AI Core 智能底座**，做到了兼具前瞻性与极简务实（Ponytail 原则），全链路代码干净、逻辑闭环、测试全绿。
