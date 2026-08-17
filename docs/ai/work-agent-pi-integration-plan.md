# Work Agent × Pi Coding Runtime 集成方案 v3.1

> **本文档是 v3.1 修订版**，基于官方 SDK/RPC/Extension 文档修正 12 个实施细节。
>
> 目标：ProjectHub 作为主产品，Pi 作为 Work Agent 内部的 **Coding Execution Runtime**，通过 SDK/RPC + Extensions 集成，不 Fork，不新增 Tab，不让 Pi 成为产品入口。

---

## 核心架构决策（版本演进）

| 决策项 | v1（错） | v2（改进） | v3（最终） |
|--------|----------|------------|------------|
| Pi 定位 | Work Agent SubAgent | Coding Execution Runtime | **Coding Runtime，通过 Pi Adapter 集成** |
| Pi tool bridge | 做了 | 第一阶段不做 | **永远不做，改用 Pi Extension** |
| HIL 拦截 | Pi 发事件 | Policy Gateway 横切 | **Policy Gateway + Extension Hook** |
| CLI vs SDK | spawn CLI | 优先 SDK | **开发 SDK，生产 RPC + Sandbox** |
| Fork Pi？ | — | — | **❌ 绝不 Fork，只用 npm install** |
| UI | 新增 Pi Tab | 改造 Work UI | **Work Agent Workspace（Pi 只出现在 Execution Panel）** |
| 业务工具接入 | Pi 调 Work Tool | — | **Pi Extension 注册 ProjectHub Native Tool** |
| Phase 顺序 | Pi first | Work first then Pi | **Work 最小闭环 → Pi Adapter → Extension** |

---

## 一、目标架构（v3 最终）

```
┌────────────────────────────────────────────────────────────────────┐
│  ProjectHub UI (浏览器)                                             │
│  Work Agent Workspace — 用户只认识这个界面                          │
└───────────────────────────────┬────────────────────────────────────┘
                                │ SSE / WebSocket
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  ProjectHub Next.js (3003)                                          │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Work Agent (Orchestration Layer)                            │  │
│  │  ├── dispatchNode    — 任务分诊                              │  │
│  │  ├── lifecycle       — 状态 + checkpoint                     │  │
│  │  ├── WorkEvent       — 统一事件流（Pi 事件透明翻译）          │  │
│  │  └── 产物落盘        — FileAsset / WorkflowRun               │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │                                           │
│          ┌──────────────┼───────────────┐                          │
│          ▼              ▼               ▼                           │
│   Workflow Runtime   Pi Adapter     Browser Runtime（未来）        │
│   周报/文档工作流    （你写的集成层）  Playwright                   │
│          │              │                                           │
│          │    ┌─────────┴──────────┐                              │
│          │    │                    │                              │
│          │  Pi SDK           Pi RPC Process                       │
│          │  Process-local     Process-isolated                   │
│          │  / embedded        / sandbox                          │
│          │              ▼                                          │
│          │     Pi Agent Runtime                                   │
│          │     (npm: @mariozechner/pi-coding-agent)               │
│          │              │                                          │
│          │    ┌─────────┼─────────────┐                          │
│          │    ▼         ▼             ▼                           │
│          │  Coding    Browser    ProjectHub                        │
│          │  Tools     Playwright  Extension ← 你写的              │
│          │              │             │                            │
│          │              │     ┌───────┴──────────┐               │
│          │              │     │  ProjectHub API   │               │
│          │              │     │  query_project    │               │
│          │              │     │  query_ticket     │               │
│          │              │     │  submit_report    │               │
│          │              │     └───────────────────┘               │
│          │              │                                          │
│          └──────────────┴──────────────────────────────┐         │
│                                    Policy Gateway ←────┘         │
│                                    ALLOW / APPROVE / DENY         │
└────────────────────────────────────────────────────────────────────┘
                                │
                         Workspace
                    /project-manager
                    AGENTS.md ← 注入
```

### 核心边界（v3 最终版）

**Work Agent 管**（ProjectHub 自己写）：
- 任务入口 + dispatch
- WorkEvent 统一事件流（前端不知道 Pi 存在）
- 生命周期（start / pause / resume / cancel）
- Policy Gateway 决策（HIL / ALLOW / DENY）
- 产物落盘（FileAsset / WorkflowRun）
- UI 状态同步（SSE）

**Pi Adapter 管**（`features/ai/agents/work/subagents/pi/`）：
- SDK/RPC 封装
- Pi 原生事件 → SubAgentEvent → WorkEvent 翻译
- Session 管理
- AGENTS.md 注入

**Pi 管**（`node_modules`，不动它的源码）：
- Reasoning / planning
- Tool calling（read / edit / write / bash）
- Coding loop（修改 → 测试 → 修改）
- Session persistence
- Extension host（加载 ProjectHub Extension）

**ProjectHub Extension 管**（`features/ai/integrations/pi-extension/`）：
- 把 ProjectHub 业务工具注册进 Pi（query_project / query_ticket 等）
- Tool Call 拦截 hook（Policy 的另一种实现方式）
- 自定义 UI Extension（可选）

**三层安全边界（职责必须分开）**：
1. **Pi Extension Hook**（`pi-extension/hooks/tool-interceptor.ts`）— `tool_call` 前置拦截，这是真正的安全闸门
2. **Policy Gateway**（`agents/work/policy/`）— 应用级安全策略（命令白名单/路径限制）
3. **Sandbox / Container** — 最终执行边界，OS 级别隔离

**❌ 绝对不做**：
- Fork Pi ❌
- Pi Tool → Work Tool 桥接 ❌
- Pi 产品 UI 作为主界面 ❌
- 新增 Pi Tab ❌
- `subagents/pi/policy.ts`（Policy 只能有一份，在 `work/policy/`）❌

---

## 二、目录结构（v3 最终）

```
features/ai/
│
├─ agents/work/
│  ├─ graph.ts                      # 改造：dispatchNode + Coding Runtime
│  ├─ router/                       # ✅ 已有（matcher 写好）
│  │
│  ├─ subagents/                    # 🆕 子代理抽象层
│  │  ├─ types.ts                  # SubAgentRun / SubAgentEvent（Run 为核心）
│  │  ├─ registry.ts               # 子代理注册（未来可挂 claude-code 等）
│  │  │
│  │  └─ pi/                       # 🆕 Pi Adapter（三层分离，不 Fork Pi）
│  │     ├─ subagent.ts            # 第一层：Work Agent 业务封装
│  │     │                          #   负责：任务是什么、workspace、结果回传
│  │     │                          #   不知道：SDK 还是 RPC
│  │     ├─ runtime.ts              # 第二层：PiRuntime 接口
│  │     │                          #   负责：start / steer / followUp / abort / resume
│  │     │                          #   基于 AgentSessionRuntime，不自造 Session 封装
│  │     ├─ events.ts               # Pi 原生事件 → WorkEvent（不含 tool_call 拦截）
│  │     ├─ session.ts              # Phase 0 后再决定：若仅为纯转发则删除
│  │     └─ transports/             # 第三层：Transport（运行时注入）
│  │        ├─ sdk.ts               # SDK Runtime：embedding in Node/TS
│  │        └─ rpc.ts              # RPC Runtime：process isolation（按需启用）
│  │
│  ├─ policy/                       # 🆕 Policy Gateway（安全横切）
│  │  ├─ index.ts                  # Policy 入口（统一 check 方法）
│  │  ├─ command-policy.ts         # 命令白名单（git status/npm test → ALLOW）
│  │  ├─ path-policy.ts            # 路径限制（禁止 rm -rf / .ssh / .env）
│  │  ├─ tool-policy.ts            # 工具级别策略
│  │  └─ approval-policy.ts        # 需要 HIL 审批的命令列表
│  │
│  ├─ runtime/                      # ✅ 已有（需接通 graph）
│  │  ├─ lifecycle.ts
│  │  ├─ approval.ts
│  │  └─ human-action.ts
│  │
│  ├─ tools/                        # ✅ 已完成（Work Agent 自有工具）
│  │  └─ ...
│  │
│  └─ workflows/                    # ✅ 已有（registry + weekly-report）
│     └─ ...
│
├─ integrations/                    # 🆕 外部集成层（v3 新增）
│  └─ pi-extension/                 # 🆕 ProjectHub Pi Extension
│     ├─ index.ts                  # Extension 入口（注册到 Pi）
│     ├─ tools/                    # 注册进 Pi 的 ProjectHub 业务工具（按 capability: read/write 分类）
│     │  ├─ query-project.ts       # Pi 可调用：查询项目数据（capability: read）
│     │  ├─ query-ticket.ts        # Pi 可调用：查询工单（capability: read）
│     │  ├─ query-commits.ts        # Pi 可调用：查询 Git 提交（capability: read）
│     │  └─ submit-report.ts        # Pi 可调用：提交周报（capability: write）
│     ├─ hooks/                    # Tool Call 拦截 hooks（Policy 补充）
│     │  └─ tool-interceptor.ts
│     └─ context/
│        └─ project-context.ts     # 注入当前项目上下文到 Pi session
│
└─ core/runtime/
   └─ work-event.ts                # 🆕 WorkEvent 统一类型（前端感知的唯一类型）
```

**三条铁规**：
- ❌ 不 Fork Pi（只 `npm install @mariozechner/pi-coding-agent`）
- ❌ 不做 pi-tool-bridge（用 Pi Extension 注册工具）
- ❌ 不新增 Pi Tab（Pi 只出现在 Execution Panel 内部）

---

## 三、SubAgent 核心类型设计（v2）

### 3.1 核心理念

**以 `SubAgentRun` 为核心实体**，不是 `SubAgentTaskInput`。

```typescript
// features/ai/agents/work/subagents/types.ts

// ─── Run 实体（Runtime 概念，不一定立刻进 DB）───────────────────────

interface SubAgentRun {
  runId: string;               // UUID
  agentType: "pi" | "claude-code" | string;  // 子代理类型
  workspaceId: string;        // 工作区标识
  sessionId: string;          // Pi session ID
  status: "pending" | "running" | "waiting_approval" | "paused" | "completed" | "failed" | "cancelled";
  parentRunId?: string;        // 父 WorkRun（可选）
  lastEventId?: string;        // SSE 重连/去重
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  lastInput?: string;
}

// ─── BaseSubAgent 接口 ──────────────────────────────────────────────

interface BaseSubAgent {
  readonly type: string;           // "pi" | "claude-code"
  readonly displayName: string;

  /** 启动一个 run，返回 handle */
  start(run: SubAgentRun, input: SubAgentInput): Promise<SubAgentHandle>;

  /** 中断运行 */
  cancel(runId: string): Promise<void>;

  /** 恢复被暂停的 run */
  resume(runId: string, userInput: string): Promise<SubAgentHandle>;

  /** 获取 run 状态 */
  getRun(runId: string): SubAgentRun | undefined;
}

interface SubAgentInput {
  prompt: string;
  workspace: string;          // 工作目录路径
  contextFiles?: string[];    // 额外上下文文件（如 AGENTS.md）
  policy?: PolicyConfig;      // 透传给 Policy Gateway
}

interface SubAgentHandle {
  runId: string;
  events: AsyncIterable<SubAgentEvent>;   // SSE 友好
  awaitCompletion(): Promise<SubAgentResult>;
}

interface SubAgentResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  artifacts: Record<string, unknown>;    // 产物
  summary?: string;
  error?: string;
  durationMs: number;
}

// ─── 事件流（与 Pi 原生事件解耦）────────────────────────────────────

type SubAgentEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "assistant_message"; runId: string; content: string; delta?: string }
  | { type: "tool_call"; runId: string; eventId: string; tool: string; args: Record<string, unknown>; callId: string }
  | { type: "tool_result"; runId: string; callId: string; result: unknown; success: boolean }
  | { type: "tool_error"; runId: string; callId: string; error: string }
  | { type: "approval_required"; runId: string; callId: string; tool: string; args: unknown; reason: string }
  | { type: "progress"; runId: string; message: string; percent?: number }
  | { type: "error"; runId: string; message: string }
  | { type: "run_completed"; runId: string; result: SubAgentResult };

// ─── Policy Gateway 类型 ────────────────────────────────────────────

type PolicyDecision = "allow" | "approve" | "deny";

interface PolicyContext {
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  workspace: string;
  userId: string;
  command?: string;           // bash 场景下提取命令
  filePaths?: string[];       // 涉及的文件路径
}

interface PolicyResult {
  decision: PolicyDecision;
  reason?: string;            // 决策理由（审计用）
  autoApprove?: boolean;       // 本次自动通过（HIL 完成后）
}
```

### 3.2 Policy 拦截位置（v3 修正：必须在 Extension hook 前置拦截）

⚠️ **架构原则**：Policy 拦截必须在 `tool_call` **之前**，而不是在 `translateEvents` 里监听 `tool_execution_*` 事件之后。

**❌ 旧设计（错误）**：
```
Pi
 ↓
tool_execution_start
 ↓
translateEvents()
 ↓
PolicyGateway.check()  ← 太晚了，工具已经执行了
```

**✅ 新设计（正确）**：
```
Pi
  ↓
tool_call  ← 拦截点
  ↓
pi-extension/hooks/tool-interceptor.ts  ← 前置 hook
  ↓
PolicyGateway.check()
  ↓
ALLOW → 放行
DENY → reject
HIL  → 暂停等审批
  ↓
Pi Tool 执行
```

**events.ts 的职责**：只负责翻译"已经发生的事情"（Pi 已执行完毕的事件 → WorkEvent），**不负责 Policy 拦截**。

```typescript
// features/ai/agents/work/subagents/pi/subagent.ts

class PiSubAgent implements BaseSubAgent {
  readonly type = "pi";
  readonly displayName = "Pi Coding Agent";

  private runtime: PiRuntime;

  async start(run: SubAgentRun, input: SubAgentInput): Promise<SubAgentHandle> {
    // 1. 注入运行时上下文（.projecthub/AGENT_CONTEXT.md）
    await this.injectRuntimeContext(input);

    // 2. 注册 Pi Extension（tool-interceptor hook 已在内部注册 Policy Gateway）
    await this.registerExtension();

    // 3. 创建 Pi session（SDK）
    const session = await this.runtime.createSession({
      cwd: input.workspace,
      model: "claude",
      extensions: [this.piExtension],  // Extension 注入
    });

    // 4. 启动 prompt
    const events = session.subscribe();

    return {
      runId: run.runId,
      // events.ts 只负责翻译，不负责拦截
      events: this.events.translate(run.runId, events),
      awaitCompletion: () => session.awaitCompletion(),
    };
  }
}
```

### 3.3 Pi Extension Hook（真正的前置拦截）

```typescript
// features/ai/integrations/pi-extension/hooks/tool-interceptor.ts

export function createToolInterceptor(policyGateway: PolicyGateway) {
  return {
    name: "projecthub-tool-interceptor",

    // ✅ 这是真正的安全闸门：在 tool_call 之前拦截
    onToolCall: async (tool: string, args: unknown): Promise<"allow" | "deny" | "hold"> => {
      const result = await policyGateway.check({
        tool,
        args: args as Record<string, unknown>,
        workspace: process.cwd(),
      });

      switch (result.decision) {
        case "allow": return "allow";
        case "deny":   return "deny";
        case "approve": return "hold";  // HIL 审批
      }
    },
  };
}
```

---

## 四、Policy Gateway（v2 核心新增）

### 4.1 设计理念

Pi 设计哲学是 **no permission popup**，安全边界由宿主环境控制。Policy Gateway 就是这个宿主安全层：

```
Pi Tool Request
      │
      ▼
Policy Gateway
      │
      ├── command-policy.ts    — 命令白名单
      ├── path-policy.ts       — 路径黑名单
      ├── tool-policy.ts      — 工具级别策略
      └── approval-policy.ts  — 需要 HIL 的命令
      │
      ▼
┌─────┬─────┬─────┐
│ALLOW│APPROV│ DENY│
└─────┴─────┴─────┘
```

### 4.2 策略示例

```typescript
// features/ai/agents/work/policy/command-policy.ts
// 仅作为策略原型（生产必须替换为结构化解析）

const ALLOW_COMMANDS = new Set([
  "git status", "git diff", "git log", "git branch",
  "ls", "find", "cat", "head", "tail", "grep",
  "npm test", "npm run lint", "npm run type-check",
  "npm run build", "pnpm test",
  "cargo test", "cargo check",
]);

const HIL_COMMANDS = new Set([
  "rm -rf", "rm -r", "rm -f",
  "git push", "git force-push", "git reset --hard",
  "sudo", "chmod 777",
  ]);

const DENY_COMMANDS = new Set([
  "git reset --hard HEAD~",
  "curl | sh", "wget | sh",
]);

export function checkCommand(command: string): PolicyResult {
  if (DENY_COMMANDS.some(d => command.includes(d))) {
    return { decision: "deny", reason: `危险命令: ${command}` };
  }
  if (HIL_COMMANDS.some(h => command.includes(h))) {
    return { decision: "approve", reason: `需审批命令: ${command}` };
  }
  if (ALLOW_COMMANDS.has(command) || ALLOW_COMMANDS.has(command.split(" ")[0])) {
    return { decision: "allow", reason: "白名单命令" };
  }
  // 默认：需审批
  return { decision: "approve", reason: `未识别命令: ${command}` };
}
```

> ⚠️ **Policy 字符串匹配不能作为最终安全边界**：
> - `npm` 前缀匹配会被 `npm whatever-dangerous-command` 绕过
> - `rm -rf` 字符串匹配会被 `bash -c 'rm -rf ...'` 绕过
> - **Policy 是应用级安全策略，最终安全边界靠 Sandbox / Container**

> 🔑 **三层安全边界**：
> 1. Pi Extension Hook（`tool_call` 前置拦截）→ 应用层
> 2. Policy Gateway（`work/policy/`）→ 应用层
> 3. Sandbox / Container → **OS 级别最终边界**
```

```typescript
// features/ai/agents/work/policy/path-policy.ts
// NOTE: 正确实现（Phase 3 实施）

import path from "path";

const PROTECTED_PATTERNS = [
  /\.ssh\//, /\.env$/, /credential/i,
  /node_modules\/\.\./, /\.git\/\.\./,
];

export function checkPaths(paths: string[], workspace: string): PolicyResult {
  for (const targetPath of paths) {
    // 1. 判断是否在 workspace 内（用 path.relative，不用 startsWith）
    const rel = path.relative(workspace, targetPath);
    const isInside = !rel.startsWith("..") && !path.isAbsolute(rel);

    if (!isInside) {
      return { decision: "deny", reason: `越出 workspace: ${targetPath}` };
    }

    // 2. 检查 protected patterns
    for (const pattern of PROTECTED_PATTERNS) {
      if (pattern.test(targetPath)) {
        return { decision: "deny", reason: `禁止路径: ${targetPath}` };
      }
    }
  }
  return { decision: "allow" };
}
```

### 4.3 Policy Gateway 入口

```typescript
// features/ai/agents/work/policy/index.ts

export class PolicyGateway {
  constructor(
    private commandPolicy = checkCommand,
    private pathPolicy = checkPaths,
    private toolPolicy = checkTool,
    private approvalPolicy = checkApproval,
  ) {}

  async check(ctx: PolicyContext): Promise<PolicyResult> {
    // 1. 工具级别策略
    const toolResult = this.toolPolicy(ctx.tool, ctx.args);
    if (toolResult.decision !== "allow") return toolResult;

    // 2. 路径策略（针对 file 操作）
    if (ctx.filePaths?.length) {
      const pathResult = this.pathPolicy(ctx.filePaths, ctx.workspace);
      if (pathResult.decision !== "allow") return pathResult;
    }

    // 3. 命令策略（针对 bash）
    if (ctx.command) {
      const cmdResult = this.commandPolicy(ctx.command);
      if (cmdResult.decision !== "allow") return cmdResult;
    }

    // 4. 审批策略
    const approvalResult = this.approvalPolicy(ctx.tool, ctx.args, ctx.command);
    if (approvalResult.decision === "approve") return approvalResult;

    return { decision: "allow" };
  }
}
```

---

## 五、运行时上下文注入（v3 修正）

**不要覆盖项目原有的 `AGENTS.md`**。Pi 通过 `cwd` 自动向上查找 `AGENTS.md`。

**区分两种上下文**：
- `AGENTS.md` = **项目永久规则**（开发者自己维护，不要覆盖）
- `.projecthub/AGENT_CONTEXT.md` = **运行时注入**（由 Pi Extension / ResourceLoader 注入）

> **不要让 AGENT_CONTEXT.md 不断膨胀**。只放：当前任务 / 用户身份 / workspace 信息 / 项目 ID / WorkflowRun ID。不放：历史事件 / 工具结果 / 数据库数据。

**旧写法**（会覆盖项目原有 AGENTS.md）：
```typescript
await fs.writeFile(path.join(workspace, "AGENTS.md"), agentsMd);
```

**新写法**（创建 .projecthub/ 目录注入运行时上下文）：
```typescript
const runtimeContextDir = path.join(workspace, ".projecthub");
await fs.mkdir(runtimeContextDir, { recursive: true });
await fs.writeFile(
  path.join(runtimeContextDir, "AGENT_CONTEXT.md"),
  runtimeContext
);
input.contextFiles.push(path.join(runtimeContextDir, "AGENT_CONTEXT.md"));
```

**收益**：Pi 读取项目 AGENTS.md 获得项目规则，读取运行时上下文获得当前任务信息，两层分离，互不覆盖。

---

## 六、实施路线（v2 — 6 个 Phase）

### Phase 0 — Pi Runtime Spike（1 天）

> **目标**：验证 Pi 的事件模型、session 恢复、Policy 拦截、sandbox 能力。

**不是验证"Pi 能不能跑"，而是验证"Pi 的生命周期和事件模型能不能被 Work Runtime 接管"。**

```
1. createAgentSession() — SDK 初始化
2. prompt() + subscribe() — 事件流验证
3. tool_call 前置 hook — Extension 拦截点
4. 自定义 ProjectHub tool — Extension registerTool
5. 外部 HIL 能否挂起并恢复 tool_call ← 架构关键点
6. steer / followUp / abort — 生命周期 API
7. session resume — 持久化验证
8. Container / workspace isolation — 基础设施验证
9. **产出**：`docs/ai/pi-runtime-spike.md`
```

**Phase 0 核心验证点**：外部 HIL 能否在 Extension `tool_call` 生命周期内安全挂起并恢复。

```
Pi Extension
    |
    +-- tool_call
    +-- 创建 approval request
    +-- 等待 ProjectHub HIL（跨 UI / 跨事件循环）
    +-- 用户点击 approve
    +-- Extension promise resolve
    +-- return undefined
    +-- Pi 继续执行
```

如果不行，退到 RPC / Host Tool 方案。**这是唯一可能迫使架构变化的点。**

### Phase 1 — Work Agent 最小闭环（2-3 天）

> **目标**：先让 Work Agent 有大脑，再挂 Pi。

**不做复杂 Planner / Critic / Reflection，只做最小 dispatch 闭环**：

```
User: "帮我做周报"
  ↓
Work Agent
  ↓
dispatchNode: 检测到 "周报" → workflow
  ↓
Workflow Runtime: weekly-report（已有）
  ↓
output: 产物落盘
  ↓
User: "帮我重构 ticket 模块"
  ↓
Work Agent
  ↓
dispatchNode: 检测到 coding 类 → 预留给 Pi（暂时返回"Pi 接入中"）
```

**文件改动**：
- `graph.ts`：dispatchNode 接入 router，coding 类任务暂时返回提示
- `ui/work/WorkModePanel.tsx`：绑定 graph.run，显示 workflow 状态
- `runtime/approval.ts`：接通 graph
- `runtime/lifecycle.ts`：接通 graph

### Phase 2 — Pi Coding SubAgent 接入（3-5 天）

> **目标**：Pi 接管 coding 类任务，Policy Gateway 横切。**从第一天就用三层分离接口设计，实际只实现 SDK**。

**核心原则：先设计接口，后实现；只做 SDK，不做 RPC，等生产需要时再加。**

```
1. 新建 subagents/types.ts（SubAgentRun + SubAgentEvent）
2. 新建 subagents/registry.ts
3. 新建 subagents/pi/ 目录
4. 实现 subagent.ts（第一层：Work Agent 业务封装）
5. 实现 runtime.ts（第二层：PiRuntime 接口，定义 start/resume/cancel/events）
6. 实现 transports/sdk.ts（第三层：SDK 封装）
7. 实现 events.ts（Pi 原生事件 → WorkEvent 翻译）
8. 实现 session.ts（session 生命周期抽象）
9. 新建 policy/ 目录（command / path / tool / approval policy）
10. 在 graph.ts 接入 PiSubAgent
11. coding 类任务 → PiSubAgent.start()
12. **产出**：`docs/ai/pi-subagent-phase2.md`
```

**三层分离的接口设计（第一天就定好）**：
```typescript
// 第二层：PiRuntime 接口（基于官方 AgentSessionRuntime）
interface PiRuntime {
  start(input: PiRunInput): Promise<PiRunHandle>;
  steer(runId: string, input: string): Promise<void>;    // 插入任务
  followUp(runId: string, input: string): Promise<void>;  // 用户介入后继续
  abort(runId: string): Promise<void>;
  resume(runId: string): Promise<PiRunHandle>;
}

// 第三层：Transport 实现（Phase 2 只实现 SDK，RPC 按需启用）
// transports/sdk.ts — embedding in Node/TS（不一定是"开发模式"）
// transports/rpc.ts — process isolation（按隔离需求启用，非"生产必选"）
```

**SDK vs RPC 选择标准是"隔离需求"，不是"开发/生产"**：
- SDK：信任 workspace、轻量任务、调试阶段
- RPC：多 workspace、高风险 shell、需要容器/sandbox
- **生产第一版很可能 Worker + Container + SDK 就够了，RPC 不是必选**

### Phase 3 — HIL + Policy + Sandbox（2-3 天）

> **目标**：完善安全体系。

```
1. HIL 审批流接通：approval_required → WorkflowRun.pendingApproval → SSE → UI
2. 完善 command-policy 白名单
3. 完善 path-policy 路径限制
4. Pi spawn 模式改为 sandboxed container（可选，Phase 3 看情况）
5. Session 持久化（SubAgentRun 进数据库）
6. **产出**：`docs/ai/pi-policy-phase3.md`
```

### Phase 4 — Workflow + Word 导出（2-3 天）

> **目标**：完善 workflow 模板 + Word 导出。

```
1. 实现 lib/export/word-exporter.ts（docx 库）
2. 周报 workflow 接入 Word 导出
3. 新增 2 个 workflow 模板（如 ticket_digest / project_report）
4. **产出**：`docs/ai/word-export-phase4.md`
```

### Phase 5 — Scheduler 定时任务（2-3 天）

> **目标**：cron 触发工作流。

```
1. 实现 jobs/scheduler-cron.ts（基于 node-cron）
2. 接入 worker/ 进程（systemd 托管）
3. 周报 cron：每周五自动生成 → 发通知 → 用户审批
4. **产出**：`docs/ai/scheduler-phase5.md`
```

---

## 七、Phase 顺序决策依据

```
P0 Pi Spike     ← 验证可行性，不依赖任何现有代码
    ↓
P1 Work 最小闭环 ← Work Agent 先有自己的大脑
    ↓
P2 Pi SubAgent  ← Pi 接入已就绪的 Work Runtime
    ↓
P3 HIL+Policy   ← Pi 能跑了，安全跟上
    ↓
P4 Workflow+Word ← 完善 workflow 生态
    ↓
P5 Scheduler   ← 定时任务（未来）
```

**核心原则**：Work Agent 的大脑（dispatch）必须先于 Pi 接入存在，否则 Pi 不知道自己什么时候被调用。

---

## 八、关键文件清单

| 文件 | 操作 | Phase |
|------|------|-------|
| `features/ai/agents/work/subagents/types.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/registry.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/subagent.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/runtime.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/events.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/session.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/transports/rpc.ts` | 🆕 新建 | P3（生产隔离时） |
| `features/ai/agents/work/policy/index.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/command-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/path-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/tool-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/approval-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/graph.ts` | ⚠️ 改造（dispatchNode + Pi 接入） | P1 + P2 |
| `features/ai/agents/work/runtime/approval.ts` | ⚠️ 接通 graph | P1 |
| `features/ai/agents/work/runtime/lifecycle.ts` | ⚠️ 接通 graph | P1 |
| `features/ai/lib/export/word-exporter.ts` | 🆕 新建 | P4 |
| `features/ai/jobs/scheduler-cron.ts` | 🆕 新建 | P5 |
| `docs/ai/pi-runtime-spike.md` | 🆕 Phase 0 产出 | P0 |
| `docs/ai/pi-subagent-phase2.md` | 🆕 Phase 2 产出 | P2 |
| `docs/ai/pi-policy-phase3.md` | 🆕 Phase 3 产出 | P3 |
| `docs/ai/word-export-phase4.md` | 🆕 Phase 4 产出 | P4 |
| `docs/ai/scheduler-phase5.md` | 🆕 Phase 5 产出 | P5 |

**不做的文件（v1 → v3 删除）**：
- `pi-tool-bridge.ts` ❌（永远不做，改用 Pi Extension）
- `pi-cli.ts` ❌（作为 pi-runtime.ts 的子模式，不单独成文件）
- `subagents/pi/policy.ts` ❌（Policy 只能有一份，统一在 `work/policy/`）

---

## 九、风险与对策（v2 更新）

| 风险 | 等级 | 对策 |
|------|------|------|
| Pi SDK 不支持 event hook / policy 拦截 | 高 | Phase 0 验证，降级为 RPC + 自己包 sandbox |
| Pi 写文件破坏项目 | 高 | Policy Gateway path-policy + workspace 隔离 |
| Pi 进程崩溃卡死 Work Agent | 高 | watchdog + 30s timeout + auto kill |
| Pi session 无法恢复 | 中 | Phase 0 验证 session persistence |
| 两套 Agent Runtime 互相打架 | 中 | Policy Gateway 统一入口，边界清晰 |
| HIL 审批无响应导致 Pi 卡死 | 中 | 默认超时 5 分钟自动 deny + 通知 |
| sandbox 性能开销大 | 低 | 开发阶段用 SDK，生产再上 sandbox |
| Pi 不支持 AGENTS.md 动态注入 | 低 | 可手动在 workspace 放 AGENTS.md |

---

## 十、SDK vs RPC 选择标准（v3 修正）

SDK vs RPC 的选择标准是**隔离需求**，不是"开发/生产阶段"。

| 场景 | 传输方式 | 原因 |
|------|----------|------|
| 信任 workspace、轻量任务、调试 | SDK | 低延迟、调试方便 |
| 多 workspace、高风险 shell、需要容器 | RPC | 进程隔离、Sandbox |
| 生产第一版（Worker + Container） | **很可能是 SDK** | RPC 不是必选 |

> **生产第一版很可能 Worker + Container + SDK 就够了，RPC 不是必选。**

```typescript
class PiRuntime {
  constructor(mode: "sdk" | "rpc" = "sdk") {
    this.mode = mode;
  }

  async createSession(opts: PiSessionOptions): Promise<PiSession> {
    if (this.mode === "sdk") {
      return new PiSdkSession(opts);
    } else {
      return new PiRpcSession(opts);  // spawn pi --mode rpc
    }
  }
}
```

---

## 十一、UI 架构决策（v3 新增）

### 11.1 核心决策

**❌ 不要新增 Pi Tab**

**✅ 改造现有 `ui/work/`，升级为 Work Agent Workspace**

原因：Pi 只是 Work Agent 内部的一种执行能力。新增 Tab 会切割用户心智，形成两套系统（Work + Pi），最终不得不在 Pi 里重做 ProjectHub 的数据 / HIL / 审批能力。

正确的用户心智：

```
ProjectHub
├── Chat  → 普通对话（Conversation Agent）
└── Work  → Work Agent（唯一入口）
              ├── Workflow Runtime
              ├── Coding Runtime (Pi)
              ├── Browser Runtime（未来）
              └── ProjectHub Tools
```

### 11.2 Pi 事件 → WorkEvent → Timeline

Pi 的原生事件统一翻译成 `WorkEvent`，前端只认识 `WorkEvent`，完全不感知 Pi 存在：

```
Pi SDK Events
    ↓
pi-events.ts (SubAgentEvent)
    ↓
WorkEvent（统一格式）
    ↓
SSE
    ↓
Work Agent Timeline（前端）
```

`WorkEvent` 统一类型设计：

```typescript
// WorkEvent 统一类型（v3.1 终版）
type WorkEvent = {
  eventId: string;                      // SSE 重连/去重必需
  runId: string;
  taskId: string;
  stepId: string;
  timestamp: number;
  executionType: "workflow" | "coding" | "browser" | "data-analysis";  // 前端只看这个，不依赖 source
} & (
  | { type: "TASK_STARTED";    description: string }
  | { type: "AGENT_DELEGATED"; agent: string; reason: string }
  | { type: "TOOL_STARTED";    tool: string; args: unknown }
  | { type: "TOOL_FINISHED";   tool: string; result: unknown; success: boolean }
  | { type: "TOOL_DENIED";     tool: string; reason: string }
  | { type: "STEP_PROGRESS";   step: string; percent?: number }
  | { type: "ARTIFACT_CREATED"; artifactType: "diff" | "file" | "report" | "log"; url: string }
  | { type: "APPROVAL_REQUIRED"; requestId: string; summary: string; tool?: string }
  | { type: "AGENT_COMPLETED"; result: string; artifacts: unknown[] }
  | { type: "TASK_FAILED";     error: string }
);
```

> ⚠️ **不要用 `source === "pi"` 决定业务逻辑**。前端只看 `executionType: "coding"`，以后换 Codex 时只需改 `executionType: "codex"`，UI 不需要改。

这层抽象的好处：以后换掉 Pi，换成 claude-code 或任意 coding runtime，前端 UI 一行不改。

### 11.3 Work Agent Workspace UI 结构（目标形态）

```
┌──────────────────────────────────────────────────────────────────┐
│ ProjectHub / Work Agent                                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  "分析最近两周项目情况，然后生成周报"                             │
│                                                                   │
│  ┌─────────────────────────┬──────────────────────────────────┐  │
│  │ Agent Timeline (左栏)   │  Execution Panel（右栏）        │  │
│  │                         │                                  │  │
│  │ ✓ 分析任务              │  ← 动态切换，根据当前步骤       │  │
│  │ ✓ 获取项目数据          │                                  │  │
│  │ ✓ 获取提交记录          │  [Coding Workspace]              │  │
│  │                         │  Files / Diff / Terminal         │  │
│  │ ▶ Coding Agent (Pi)    │                                  │  │
│  │   ✓ read package.json  │  [DataAnalysisView]              │  │
│  │   ✓ npm test           │  工单数 / 提交数 / 风险           │  │
│  │   ✓ 输出风险分析        │                                  │  │
│  │                         │  [ApprovalPanel]                 │  │
│  │ ▶ 生成周报              │  批准提交 / 返回修改             │  │
│  │   ✓ 草稿生成            │                                  │  │
│  │                         │  [ReportPreview]                 │  │
│  │ ⚠ 等待审批              │  周报内容预览                    │  │
│  └─────────────────────────┴──────────────────────────────────┘  │
│                                                                   │
│  [停止] [继续] [查看 Diff] [打开 Workspace] [批准提交]           │
└──────────────────────────────────────────────────────────────────┘
```

### 11.4 `ui/work/` 目录改造路线

**现在（Workflow UI）**：
```
ui/work/
├── WorkModePanel.tsx
├── WorkflowLauncher.tsx
├── WorkflowMatchCard.tsx
├── WorkflowStatusCard.tsx
├── WorkflowThinking.tsx
├── ChatReviewPanel.tsx
└── index.ts
```

**改造后（Work Agent Workspace）**：
```
ui/work/
│
├── WorkAgentWorkspace.tsx      # 🔄 顶层容器（主布局，左右双栏）
│
├── timeline/                  # 🔄 改造自 WorkflowThinking + WorkflowStatus
│   ├── WorkTimeline.tsx        # 事件流时间线（AgentStep 列表）
│   ├── AgentStep.tsx           # 单步展示（icon + 状态 + 展开）
│   ├── ToolCallItem.tsx        # tool_call 事件展示
│   └── ToolResultItem.tsx      # tool_result 事件展示
│
├── execution/                 # 🆕 动态右侧面板
│   ├── ExecutionPanel.tsx      # 根据 WorkEvent.type 动态切换子视图
│   ├── WorkflowView.tsx        # 🔄 改造自 WorkflowStatusCard
│   ├── CodingWorkspace.tsx     # 🆕 Coding 执行视图（Pi 能力）
│   │   ├── FileTree.tsx        # 工作区文件树
│   │   ├── DiffViewer.tsx      # 代码 diff 展示
│   │   └── TerminalOutput.tsx  # bash 输出
│   │   └── executionId         # 右侧面板独立状态（selectedFile/terminalTab/diffTab）
│   ├── DataAnalysisView.tsx    # 🆕 数据分析视图（工单/提交/风险）
│   └── BrowserWorkspace.tsx   # 🆕 预留 Browser Runtime（未来）
│
├── approval/                  # 🔄 改造自 ChatReviewPanel
│   ├── ApprovalPanel.tsx       # HIL 审批操作面板
│   └── DiffReview.tsx          # 带 diff 的审批视图
│
└── artifacts/                 # 🆕 产物预览
    ├── FilePreview.tsx
    ├── ReportPreview.tsx        # 周报预览 + Word 导出按钮
    └── index.ts
```

**改造原则**：
- `WorkModePanel` → 重构为 `WorkAgentWorkspace`（主布局）
- `WorkflowThinking` → 演进为 `WorkTimeline`（能展示 Pi 的 tool_call）
- `WorkflowStatusCard` → 演进为 `WorkflowView`（子视图之一）
- `ChatReviewPanel` → 演进为 `ApprovalPanel`（更通用）
- `WorkflowLauncher` / `WorkflowMatchCard` → 保留，迁入 Workspace 中

**不新增**：
- Pi Tab ❌
- Pi 独立页面 ❌
- 嵌入 Pi 原生 Web UI ❌（只借鉴能力，不引入包）

### 11.5 ExecutionPanel 动态切换逻辑（Registry 模式）

```typescript
// features/ai/ui/work/execution/ExecutionPanel.tsx

// 从第一天就用 Registry 模式，避免以后大量 if/else
const executionViewRegistry = {
  workflow: WorkflowView,
  coding: CodingWorkspace,
  browser: BrowserWorkspace,
  analysis: DataAnalysisView,
  approval: ApprovalPanel,
  report: ReportPreview,
} as const;

type ExecutionViewType = keyof typeof executionViewRegistry;

function ExecutionPanel({ latestEvent, executionType }: Props) {
  const View = executionViewRegistry[executionType] ?? DataAnalysisView;
  return <View latestEvent={latestEvent} />;
}
```

这样以后接入 Browser Agent，只需在 Registry 里加一行 `browser: BrowserWorkspace`，UI 完全不需要重写。

---

## 十二、完整文件清单（v3 更新，含 UI）

| 文件 | 操作 | Phase |
|------|------|-------|
| `features/ai/agents/work/subagents/types.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/registry.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/subagent.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/runtime.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/events.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/session.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 🆕 新建 | P2 |
| `features/ai/agents/work/subagents/pi/transports/rpc.ts` | 🆕 新建 | P3（生产隔离时） |
| `features/ai/agents/work/policy/index.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/command-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/path-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/tool-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/policy/approval-policy.ts` | 🆕 新建 | P3 |
| `features/ai/agents/work/graph.ts` | ⚠️ 改造（dispatchNode + Pi 接入） | P1 + P2 |
| `features/ai/agents/work/runtime/approval.ts` | ⚠️ 接通 graph | P1 |
| `features/ai/agents/work/runtime/lifecycle.ts` | ⚠️ 接通 graph | P1 |
| `features/ai/lib/export/word-exporter.ts` | 🆕 新建 | P4 |
| `features/ai/jobs/scheduler-cron.ts` | 🆕 新建 | P5 |
| `features/ai/ui/work/WorkAgentWorkspace.tsx` | 🔄 改造自 WorkModePanel | P1 |
| `features/ai/ui/work/timeline/WorkTimeline.tsx` | 🔄 改造自 WorkflowThinking | P1 |
| `features/ai/ui/work/timeline/AgentStep.tsx` | 🆕 新建 | P1 |
| `features/ai/ui/work/timeline/ToolCallItem.tsx` | 🆕 新建 | P2 |
| `features/ai/ui/work/execution/ExecutionPanel.tsx` | 🆕 新建 | P2 |
| `features/ai/ui/work/execution/WorkflowView.tsx` | 🔄 改造自 WorkflowStatusCard | P1 |
| `features/ai/ui/work/execution/CodingWorkspace.tsx` | 🆕 新建（Pi 能力） | P2 |
| `features/ai/ui/work/execution/DiffViewer.tsx` | 🆕 新建 | P2 |
| `features/ai/ui/work/execution/TerminalOutput.tsx` | 🆕 新建 | P2 |
| `features/ai/ui/work/approval/ApprovalPanel.tsx` | 🔄 改造自 ChatReviewPanel | P3 |
| `features/ai/ui/work/artifacts/ReportPreview.tsx` | 🆕 新建 | P4 |
| `features/ai/core/runtime/work-event.ts` | 🆕 新建（WorkEvent 统一类型） | P1 |
| `docs/ai/pi-runtime-spike.md` | 🆕 Phase 0 产出 | P0 |
| `docs/ai/pi-subagent-phase2.md` | 🆕 Phase 2 产出 | P2 |
| `docs/ai/pi-policy-phase3.md` | 🆕 Phase 3 产出 | P3 |
| `docs/ai/word-export-phase4.md` | 🆕 Phase 4 产出 | P4 |
| `docs/ai/scheduler-phase5.md` | 🆕 Phase 5 产出 | P5 |

**不做的文件**：
- `pi-tool-bridge.ts` ❌（第一阶段不做）
- `pi-cli.ts` ❌（作为 pi-runtime.ts 的子模式）
- Pi Tab / Pi 独立页面 ❌（不新增 Tab）

---

## 十三、关联 Skill 与文档

| 用途 | 文件 |
|------|------|
| 开发操作 | `~/.cursor/skills/pm-dev/SKILL.md` |
| LangGraph 参考 | `~/.cursor/skills/dive-into-langgraph/SKILL.md` |
| UI 美化规范 | `.cursor/skills/pretty-ui/SKILL.md` |
| 阶段产出归档 | `~/.cursor/skills/dev-to-doc-recap/SKILL.md` |
| git commit | `~/.cursor/skills/git-commit-assistant/SKILL.md` |
| 子代理协作 SOP | `~/.cursor/rules/subagent-coordination-sop.mdc` |

Pi 官方文档：
- [pi-mono/README.md](https://github.com/bokan/pi-mono)
- [pi/packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi)
- [AGENTS.md 支持](https://github.com/AdamsGH/pi-mono)