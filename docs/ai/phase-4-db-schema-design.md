# Phase 4 - DB Schema 设计文档

## 概述

Phase 4 需要将 3 个核心实体持久化到数据库：
1. **PolicyAuditLog** - Policy Gateway 审计日志
2. **PolicyRule** - Policy 规则外部化
3. **SubAgentRun** - SubAgent 运行会话

## 1. PolicyAuditLog - 审计日志

### 业务需求

- 记录所有 Policy Gateway 检查结果（allow / approve / deny）
- 支持合规审计和安全事件溯源
- 支持按用户、工具、时间范围查询
- 需要高性能写入（每个 tool_call 都会记录）

### Schema 设计

```prisma
model PolicyAuditLog {
  id         String          @id @default(cuid())
  runId      String          // SubAgent run ID
  userId     String          // 执行用户
  tool       String          // 工具名称（bash, read_file, git_push 等）
  args       Json            // 工具参数
  decision   PolicyDecision  // allow | approve | deny
  reason     String?         // 决策原因（deny 时必填）
  command    String?         // bash 工具的命令（仅 shell 类工具）
  filePaths  String[]        // 文件路径（仅文件类工具）
  workspace  String          // 工作目录
  approvedAt DateTime?       // HIL 审批时间（仅 approve 决策）
  approvedBy String?         // HIL 审批人（仅 approve 决策）
  createdAt  DateTime        @default(now())
  
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([runId])
  @@index([tool, createdAt(sort: Desc)])
  @@index([decision, createdAt(sort: Desc)])
  @@schema("pm")
}

enum PolicyDecision {
  ALLOW
  APPROVE
  DENY
  
  @@schema("pm")
}
```

### 索引策略

- `[userId, createdAt]` - 用户审计日志查询（最常用）
- `[runId]` - 按 run 查询所有决策
- `[tool, createdAt]` - 按工具类型分析
- `[decision, createdAt]` - 安全事件分析（特别是 DENY）

## 2. PolicyRule - 规则外部化

### 业务需求

- 从硬编码迁移到数据库驱动
- 支持运行时动态更新规则（无需重启服务）
- 支持规则启用/禁用
- 支持规则优先级排序

### Schema 设计

```prisma
model PolicyRule {
  id          String           @id @default(cuid())
  ruleType    PolicyRuleType   // TOOL_WHITELIST | TOOL_BLACKLIST | COMMAND_WHITELIST | COMMAND_BLACKLIST | PATH_BLACKLIST
  pattern     String           // 规则模式（工具名 / 命令前缀 / 路径前缀）
  decision    PolicyDecision   // 匹配后的决策（ALLOW / APPROVE / DENY）
  reason      String?          // 决策原因说明
  priority    Int              @default(0) // 优先级（数字越大越优先）
  enabled     Boolean          @default(true)
  metadata    Json?            // 扩展字段（如正则表达式、额外条件等）
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  createdBy   String?          // 创建者（可选，用于审计）
  
  creator     User?            @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([ruleType, enabled])
  @@index([priority(sort: Desc)])
  @@schema("pm")
}

enum PolicyRuleType {
  TOOL_WHITELIST      // 工具白名单（匹配即 ALLOW）
  TOOL_BLACKLIST      // 工具黑名单（匹配即 DENY）
  TOOL_HIL            // 工具需要 HIL（匹配即 APPROVE）
  COMMAND_WHITELIST   // 命令白名单（匹配即 ALLOW）
  COMMAND_BLACKLIST   // 命令黑名单（匹配即 DENY）
  PATH_BLACKLIST      // 路径黑名单（匹配即 DENY）
  
  @@schema("pm")
}
```

### 规则示例数据

```typescript
// 初始规则（迁移时从 hardcode 导入）
const initialRules = [
  // 工具规则
  { ruleType: "TOOL_WHITELIST", pattern: "read_file", decision: "ALLOW" },
  { ruleType: "TOOL_WHITELIST", pattern: "write_file", decision: "ALLOW" },
  { ruleType: "TOOL_HIL", pattern: "git_push", decision: "APPROVE", reason: "推送代码需要审批" },
  { ruleType: "TOOL_HIL", pattern: "git_force_push", decision: "APPROVE", reason: "强制推送需要审批" },
  { ruleType: "TOOL_BLACKLIST", pattern: "system_shutdown", decision: "DENY", reason: "禁止关机操作" },
  
  // 命令规则
  { ruleType: "COMMAND_WHITELIST", pattern: "npm run", decision: "ALLOW" },
  { ruleType: "COMMAND_WHITELIST", pattern: "git status", decision: "ALLOW" },
  { ruleType: "COMMAND_BLACKLIST", pattern: "rm -rf /", decision: "DENY", reason: "危险删除操作" },
  { ruleType: "COMMAND_BLACKLIST", pattern: "dd if=", decision: "DENY", reason: "底层磁盘操作" },
  
  // 路径规则
  { ruleType: "PATH_BLACKLIST", pattern: "/etc/", decision: "DENY", reason: "系统配置目录" },
  { ruleType: "PATH_BLACKLIST", pattern: "/var/", decision: "DENY", reason: "系统运行目录" },
  { ruleType: "PATH_BLACKLIST", pattern: ".env", decision: "DENY", reason: "环境变量文件" },
];
```

## 3. SubAgentRun - 运行会话

### 业务需求

- 记录 SubAgent 运行历史（Pi / Claude Code / 未来其他）
- 支持 HIL 审批时的状态管理（`waiting_approval`）
- 支持跨请求恢复会话（`resume()`）
- 与现有 `WorkflowRun` 类似，但语义不同

### Schema 设计

```prisma
model SubAgentRun {
  id             String            @id @default(cuid())
  runId          String            @unique // 业务 ID（run_xxx）
  sessionId      String            // Pi SDK session ID
  agentType      String            // pi | claude-code | ...
  userId         String            // 执行用户
  workspaceId    String            // 工作空间路径（或项目 ID）
  status         SubAgentStatus    // pending | running | waiting_approval | paused | completed | failed | cancelled
  parentRunId    String?           // 父 run ID（支持嵌套）
  prompt         String            // 初始 prompt
  contextFiles   String[]          // 上下文文件列表
  lastEventId    String?           // 最后处理的事件 ID
  lastInput      String?           // 最后的用户输入（用于 resume）
  result         Json?             // 运行结果（SubAgentResult）
  error          String?           // 错误信息
  startedAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  completedAt    DateTime?         // 完成时间
  durationMs     Int?              // 运行时长（毫秒）
  
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  auditLogs      PolicyAuditLog[]  @relation("RunAuditLogs")

  @@index([userId, startedAt(sort: Desc)])
  @@index([status, startedAt(sort: Desc)])
  @@index([agentType, startedAt(sort: Desc)])
  @@index([sessionId])
  @@schema("pm")
}

enum SubAgentStatus {
  PENDING
  RUNNING
  WAITING_APPROVAL  // HIL 审批中
  PAUSED
  COMPLETED
  FAILED
  CANCELLED
  
  @@schema("pm")
}
```

### 索引策略

- `[userId, startedAt]` - 用户运行历史查询
- `[status, startedAt]` - 按状态过滤（特别是 `waiting_approval`）
- `[agentType, startedAt]` - 按 agent 类型分析
- `[sessionId]` - Pi SDK 会话 ID 快速查找

## 4. 关系图

```
User
  ├─ PolicyAuditLog[] (审计日志)
  ├─ PolicyRule[] (创建的规则)
  └─ SubAgentRun[] (运行会话)

SubAgentRun
  └─ PolicyAuditLog[] (该 run 的所有审计记录)
```

## 5. 迁移计划

### Step 1: 添加 Enum 类型

```prisma
enum PolicyDecision { ALLOW, APPROVE, DENY }
enum PolicyRuleType { TOOL_WHITELIST, TOOL_BLACKLIST, TOOL_HIL, COMMAND_WHITELIST, COMMAND_BLACKLIST, PATH_BLACKLIST }
enum SubAgentStatus { PENDING, RUNNING, WAITING_APPROVAL, PAUSED, COMPLETED, FAILED, CANCELLED }
```

### Step 2: 添加 Model

按顺序添加：
1. `PolicyAuditLog` (无外键依赖)
2. `PolicyRule` (无外键依赖)
3. `SubAgentRun` (依赖 `User`)

### Step 3: 更新 User 模型

```prisma
model User {
  // ... 现有字段
  policyRules       PolicyRule[]
  policyAuditLogs   PolicyAuditLog[]
  subAgentRuns      SubAgentRun[]
}
```

### Step 4: 生成迁移文件

```bash
npx prisma migrate dev --name add_phase4_policy_and_subagent_tables
```

### Step 5: 初始化规则数据

运行数据迁移脚本，将 hardcode 规则导入 `PolicyRule` 表。

## 6. 性能考虑

### PolicyAuditLog

- **写入频率高**：每个 tool_call 都会写入，预估 QPS 10-100
- **优化策略**：
  - 使用批量插入（每 10 条或 1 秒批量写入）
  - 考虑异步写入（不阻塞 tool_call 执行）
  - 定期归档历史数据（如 90 天后迁移到冷存储）

### PolicyRule

- **读取频率高**：每个 tool_call 都会查询规则
- **优化策略**：
  - 应用层缓存（启动时加载，规则变更时刷新）
  - 内存中按 `ruleType` 分组索引
  - 规则数量预估 < 100 条，全量缓存可接受

### SubAgentRun

- **写入频率中**：每个 run 启动/更新/完成时写入
- **优化策略**：
  - `status` 更新使用乐观锁（`updatedAt` 版本控制）
  - `result` 使用 JSONB 类型，支持部分更新

## 7. 安全考虑

### 数据脱敏

- `PolicyAuditLog.args` 可能包含敏感数据（如文件内容、命令参数）
- 建议：
  - 对敏感字段（如 password、token）进行脱敏
  - 定期审计日志访问权限

### 访问控制

- `PolicyRule` 只能由 `ROOT` 角色修改
- `PolicyAuditLog` 只能查看自己的审计记录（或 `ROOT` 可查看全部）
- `SubAgentRun` 只能查看自己的运行记录

## 8. API 设计

### PolicyRule CRUD

```typescript
// GET /api/admin/policy/rules - 列出所有规则
// POST /api/admin/policy/rules - 创建规则
// PATCH /api/admin/policy/rules/:id - 更新规则
// DELETE /api/admin/policy/rules/:id - 删除规则
// POST /api/admin/policy/rules/reload - 重新加载缓存
```

### PolicyAuditLog 查询

```typescript
// GET /api/admin/policy/audit - 查询审计日志
// Query params: userId, tool, decision, startDate, endDate, limit, offset
```

### SubAgentRun 查询

```typescript
// GET /api/ai/work/runs - 查询运行历史
// GET /api/ai/work/runs/:runId - 查询单个运行详情
// POST /api/ai/work/runs/:runId/cancel - 取消运行
```

## 9. 后续优化

- **Phase 5**：PolicyRule 支持正则表达式匹配（当前只支持前缀匹配）
- **Phase 6**：PolicyAuditLog 接入 ELK/Loki 等日志分析系统
- **Phase 7**：SubAgentRun 支持分布式追踪（OpenTelemetry）
