# AiChat 与 Work 双链路联合架构演进实施方案

> **定位**：在现有已验证架构基础上，收敛控制权错位，解耦硬编码正则，打通底层共享基础设施，保持 Chat（对话问答）与 Work（交付执行）各自清晰的产品职责。
> **原则**：复用既有能力，不推倒重来；防过度设计，按需共享；先重配控制权，后清理旧逻辑。

---

## 一、架构设计全景

### 1. 职责边界划分

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Shared AI Core 基础设施                          │
│  ├─ Domain Queries: queryTicket / queryUser / queryProject / queryCommit   │
│  ├─ Resolvers & Policy: resolveDataScope / resolveUser (被动) / TimeWindow  │
│  ├─ Model Runtime: callAgnes / Token Management / Model Registry            │
│  └─ Storage: AiConversation / AiChatMessage / WorkflowRun (互通软链接)       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────┐     ┌───────────────────────────────────────┐
│     AiChat: Answer Runtime    │     │      Work: Goal Execution Runtime     │
│       (基于 LangGraph)        │     │       (基于 Work Orchestrator)        │
├───────────────────────────────┤     ├───────────────────────────────────────┤
│ 1. Input Preprocessor (事实抽取)│    │ 1. Capability Pre-check (Coding快速分流)│
│ 2. decideChatRoute (LLM决策)  │     │ 2. decideWorkStrategy (LLM决策)        │
│ 3. Passive Entity Grounding   │     │    ├─ direct: 闲聊咨询直出             │
│ 4. Hybrid RAG / Graph / DB    │     │    ├─ clarify: 数据缺陷澄清拦截        │
│ 5. Task-critical HIL (收紧消歧)│    │    ├─ workflow: 模板分派真正启动       │
│ 6. Response Synthesis (流式吐字)│    │    └─ planner: 严格 Critic 多步拆解   │
│                               │     │ 3. Two-tier HIL (Plan Gate / Action) │
│                               │     │ 4. Persistent Executor (CAS幂等防重放)│
│                               │     │ 5. C10 Evaluator 质检裁判            │
└───────────────────────────────┘     └───────────────────────────────────────┘
```

---

## 二、需要规避的过度设计与技术陷阱（Avoid List）

| 潜在设计陷阱 | 规避策略 |
| --- | --- |
| ❌ **全量对话两阶段大模型串行**（Chat 每次问答都调两次大模型，导致 TTFT 翻倍至 2.5s 以上） | **微型决策**：Chat 决策模型使用轻量 Flash 模型，Prompt 极限压缩，输出严格限制在 40 tokens JSON；纯闲聊快速跳过重检。 |
| ❌ **创建“万能超大 Capability Registry”**（把 Chat 的 Markdown 检索和 Work 的 CAS 状态机工具强合为一） | **下沉 Domain Queries 而非强合 Tool Wrappers**：共享底层的数据库查询函数（`queryTicket` 等），上层 Chat 和 Work 允许按各自的运行时契约包装工具。 |
| ❌ **推倒现有的 Hybrid Search / GraphRAG 管线**（推翻经过验证的 1024 维向量与图展开算法） | **保留 RAG 底层实现**：仅将上游的布尔开关（`needsStructured`/`needsHybrid`）重整为按需配置，检索计算与重排数学算法原样复用。 |
| ❌ **Chat 识别到工作流时强制重定向**（直接把用户从当前聊天页面强跳到工作台） | **卡片建议模式（Non-intrusive Handoff）**：在 Chat 流中吐出优雅的建议卡片（`workflow_match`），由用户自主点击切入。 |
| ❌ **全局永久封禁某动作指纹** | **作用域绑定**：拒绝指纹绑定在当前 `runId` 与会话上下文中，不造成跨任务永久误杀。 |

---

## 三、分阶段实施路线（Migration Plan）

### 阶段 1：Chat 前置意图与消歧链路根治（P0，解决“你好”弹人名 Bug）

#### 1.1 约束与被动化 `extractUserIdentifier`（`query-parser.ts`）

* **改造前**：从自然语言中粗暴切词，漏掉“你好”导致人名提取为“你好”。
* **改造后**：
  * 增加严格前置约束：只有包含人名指示词（“负责人”、“作者”、“assigned:”、“@”）或上游明确指定提取时才尝试提取；
  * 将常见口语问候（“你好”、“您好”、“请问”、“谢谢”等）加入硬性剔除列表，绝不允许提取为用户名；
  * 当提取出的人名置信度低且无强指示词时，返回 `null`。

#### 1.2 收紧消歧拦截门槛（`decision.ts` / `disambiguateIntentNode`）

* **改造前**：`candidates.length > 1` 无脑打断对话。
* **改造后**：
  * 只有在 `queryType === "user"` 且用户意图**明确是寻找/对比特定人员工作**时才进入 HIL；
  * 如果搜索是宽泛的（如功能探索或常规问答），将候选名单直接作为正文回答参考，**不打断对话流**。

#### 1.3 引入 Chat 快速决策逻辑（`detect-intent.ts`）

* 扩展 `isPureChat` 覆盖包含“请介绍一下”、“你能做什么”等功能性自我介绍语句；
* 对日常引导类问答直接走 `mode: "chat"` 直通生成，不触发任何底层实体库查重。

---

### 阶段 2：底座能力库下沉与共享（P1）

#### 2.1 抽取共享 Domain Core（`features/ai/core/queries/`）

* 规范化 5 个核心业务查询函数：
  * `queryTicket(params, viewerScope)`
  * `queryUserActivity(params, viewerScope)`
  * `queryProjectOverview(params, viewerScope)`
  * `queryStatusHistory(params, viewerScope)`
  * `queryGitCommits(params, viewerScope)`
* 统一接入 `resolveDataScope(userId, role)`，服务端强制权限隔离。

#### 2.2 双端适配器分流

* **Chat 侧**：`search-structured.ts` 节点调用共享查询核心，产出带超链接的展示文本与 `SourceReference[]`。
* **Work 侧**：`tools/business-query.ts` 调用共享查询核心，产出带 `total`、`returned`、`truncated` 的审计结构。

---

### 阶段 3：Work 链路深度打磨（P1）

#### 3.1 梳理 Workflow Registry（`features/ai/agents/work/workflows/registry.ts`）

* 统一规范 `WorkflowDefinition`：

  ```ts
  export interface WorkflowDefinition {
    id: string;
    type: string;
    name: string;
    description: string;
    requiredInputs: string[];
    riskLevel: "low" | "medium" | "high";
    entrypoint: (options: any) => Promise<any>;
  }
  ```

* 避免路由器硬编码 switch-case，统一经由 `resolveTemplateType()` 动态匹配。

#### 3.2 质检裁判节点联动推进

* 在 `evaluator.ts` 判定为 `replan` 时，与前端底部跟进输入框联动，自动展示改进指引。

---

## 四、核心验证场景集（Verification Cases）

| 链路 | 输入用例 | 预期行为（Success Criteria） |
| --- | --- | --- |
| **Chat** | “你好，请介绍一下工作台能帮我做什么” | **直接回答**，介绍系统核心功能，**严禁弹出任何用户消歧卡片** |
| **Chat** | “张工最近在做什么” | 提取“张工”，识别意图为人员动态，若张工重名且置信度相当，允许弹出选人消歧 |
| **Chat** | “#10208 属于哪个项目” | 提取工单号，直接走单工单结构化查询并回答，不强行发起全库 RAG |
| **Chat** | “帮我分析最近项目问题并生成正式复盘” | 输出分析思路，同时在流式末尾呈现工作流建议卡片（引导点击进入 Work 模式） |
| **Work** | “你好” | `mode: "direct"` 直接问答，零审批门禁，自动置为 `done` |
| **Work** | “统计上个月延期的所有外部工单…” | `mode: "clarify"`，准确拦截“外部工单”字段缺失，下发澄清卡片 |
| **Work** | “统计上个月所有延期工单并出复盘” | `mode: "planner"`，Critic 校验通过，审阅计划，批准后执行生成复盘报告 |
| **Work** | 审阅计划时反馈“步骤偏多，精简至两步” | 正常控制流流转，生成 Plan v2，精简为 2 步重新等待审批 |

---

## 五、受控实施安全守则

1. 保持当前 Git 树的安全性，严禁 `git reset`、`git checkout .` 或丢失既有未提交改动。
2. 所有 TypeScript 改动后必须立即执行 `npx tsc --noEmit` 保证 **0 errors**。
3. 所有单元测试必须执行 `npx vitest run features/ai/agents/work` 保证 **全绿无回归**。
4. 任何对生产文件的修改遵守单一写入者串行原则。
