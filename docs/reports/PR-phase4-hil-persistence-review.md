# Phase 4 HIL + Persistence 双审查合并报告

> 合并自:
> - `docs/reviews/PR-phase4-hil-persistence-code-reviewer.md` (硬层)
> - `docs/reviews/PR-phase4-hil-persistence-ai-mentor.md` (软层)
>
> 合并人: Main Agent
> 合并时间: 2026-08-19

---

## 📊 审查摘要

| 维度 | code-reviewer (硬层) | ai-learning-mentor (软层) | 合并结论 |
|------|---------------------|--------------------------|---------|
| **状态** | ❌ CHANGES_REQUIRED | ✅ APPROVED | ❌ **CHANGES_REQUIRED** |
| **阻塞问题** | 3 项 P0 | 0 项 | **3 项 P0 必须修复** |
| **架构评价** | - | ✅ 设计合理 | ✅ 架构通过 |
| **代码质量** | ⚠️ 多处硬层问题 | - | ⚠️ 需修复 |

---

## 🚨 P0 阻塞问题(必须修复)

### P0-1: PolicyRule schema 与代码字段不匹配 ⚠️⚠️⚠️

**发现者**: code-reviewer

**影响**: PolicyRule 写入/读取全路径在运行时崩溃

**问题**:
- Schema 实际字段: `pattern` / `decision` / `priority`
- 代码引用字段: `targetName` / `riskLevel` (不存在)
- `tool-policy.ts:148`: `if (rule.ruleType === "TOOL" && rule.targetName)` 
- `tool-policy.ts:150`: `mapRiskLevel(rule.riskLevel)`
- `route.ts:79-93`: 接收并写入这些不存在的字段

**修复方案**(二选一):
1. **方案 A(推荐)**: 给 `PolicyRule` schema 添加 `targetName String?` 和 `riskLevel String` 字段,同步更新 migration
2. **方案 B**: 修改代码使用 `pattern` / `decision` 字段(失去语义)

**额外发现**: `tool-policy.ts:148` 比对的是 `"TOOL"`,但 schema 枚举是 `TOOL_WHITELIST/TOOL_BLACKLIST/TOOL_HIL`,字符串不匹配导致 DB 永远 load 不出任何规则

### P0-2: sdk.ts 重复导入 prisma ⚠️

**发现者**: code-reviewer

**影响**: TS2300 编译错误,build 阻塞

**问题**: `features/ai/agents/work/subagents/pi/transports/sdk.ts:14,26` 两次 `import { prisma }`

**修复**: 删除第 26 行的重复 import

**预计耗时**: 5 行,1 分钟

### P0-3: policy/index.ts 隐式 any ⚠️

**发现者**: code-reviewer

**影响**: TypeScript strict 模式下失去类型安全

**问题**: `features/ai/agents/work/policy/index.ts:176` `.map(log => ...)` 中 `log` 未显式标注类型

**修复**: 显式标注 `logs.map((log: typeof logs[number]) => ...)`

**预计耗时**: 3 行,2 分钟

---

## ⚠️ P1 重要问题(建议尽快修复)

### P1-1: HIL Promise race condition 🔴

**发现者**: code-reviewer + ai-learning-mentor (交叉发现)

**问题**: `pausedRuns.set()` 被调用两次,第二次覆盖第一次的 resolve,导致超时清理逻辑混乱

**修复**: 抽出 `createPausedRun(runId)` 函数,避免重复 set

**预计耗时**: 15 行

### P1-2: approve API 缺 ownership 检查 🔴

**发现者**: code-reviewer

**问题**: 用户 A 可以审批用户 B 的 run

**修复**: 在 `updateApproval` 和 `approve/route.ts` 中添加 ownership 校验

**预计耗时**: 10 行

### P1-3: approve GET 端点字符串过滤 bug 🔴

**发现者**: code-reviewer

**问题**: `entry.timestamp.includes("approved")` 永远为 false (timestamp 是 ISO 字符串)

**修复**: 改为 Prisma filter `approvedAt: null`

**预计耗时**: 5 行

### P1-4: 超时定时器无清理 🟡

**发现者**: code-reviewer

**问题**: cancel 路径不清理 setTimeout,5 分钟内 event loop 有泄漏引用

**修复**: cancel 时同步 `clearTimeout(timeout)`

**预计耗时**: 3 行

### P1-5: SubAgentRun 缓存重建缺失 🟡

**发现者**: ai-learning-mentor

**问题**: 进程重启时 `pausedRuns` Map 丢失,待审批的 run 无法恢复

**修复**: 在 `PiSdkRuntime` 初始化时,从 DB 查询 `status = "WAITING_APPROVAL"` 重建 pausedRuns

**优先级**: Phase 5 必须处理(进入生产前)

### P1-6: PolicyAuditLog 敏感数据脱敏缺失 🟡

**发现者**: ai-learning-mentor

**问题**: `args` 字段可能含密码/token,直接存储不安全

**修复**: 在 `persistAuditLog` 前添加脱敏步骤

**优先级**: Phase 5 必须处理(进入生产前)

### P1-7: 审计日志内存/DB 一致性 🟡

**发现者**: code-reviewer

**问题**: 内存日志和 DB 日志是两个独立数据源,降级逻辑可能返回不完整数据

**评价**: 设计文档已明确这个 trade-off,可接受

---

## ✅ 亮点(双审查认可)

### 架构层面 (ai-learning-mentor)

1. **HIL 闭环设计清晰**: Promise + resolve 模式,协程思维,不是回调地狱
2. **三表职责划分合理**: PolicyAuditLog/PolicyRule/SubAgentRun 各自独立
3. **PolicyGateway 中心化审计**: 单一职责,可测试性强
4. **技术债务已识别**: Mock 实现有明确的 Phase 5 替换计划

### 代码层面 (code-reviewer)

1. **FSD 边界正确**: `policy/` 和 `subagents/pi/` 四层分离清晰
2. **ROOT 权限校验完整**: PolicyRule API 每个 handler 都检查
3. **路径安全**: `path.relative()` 防越界,不用 `startsWith` 被前缀攻击
4. **索引策略合理**: `userId+createdAt / runId / tool+createdAt` 四个查询场景覆盖
5. **错误处理模式统一**: 所有 API 路由 `try/catch` + 5xx + console.error

---

## 📋 修复优先级清单

### 立即修复(预计 30 分钟)

```
[ ] P0-2: 删除 sdk.ts:26 重复 import (1 分钟)
[ ] P0-3: 给 policy/index.ts:176 加显式类型 (2 分钟)
[ ] P0-1: 确认 schema 字段方案(Main 决策) → 执行修复 (15 分钟)
[ ] P1-3: approve GET 改 Prisma filter (5 分钟)
```

### 本次 PR 修复(预计 1 小时)

```
[ ] P1-1: 合并 HIL Promise resolver 逻辑 (15 分钟)
[ ] P1-2: 添加 ownership 检查 (10 分钟)
[ ] P1-4: cancel 时清理超时定时器 (3 分钟)
```

### Phase 5 必须处理

```
[ ] P1-5: SubAgentRun 缓存重建
[ ] P1-6: PolicyAuditLog 敏感数据脱敏
[ ] 命令/路径规则外部化
[ ] Pi SDK 真实 API 接入
```

---

## 🎯 最终结论

### 状态: ❌ CHANGES_REQUIRED

### 理由

**硬层(code-reviewer)**: P0-1 单独就足以让 PolicyRule 写入/读取在运行时崩溃,加上 P0-2 的编译错误和 P0-3 的类型安全问题,整个 build 无法通过。P1-3 的字符串过滤 bug 是静默错误,会导致 approve API 返回错误数据。

**软层(ai-learning-mentor)**: 架构设计合理,HIL 闭环清晰,三表职责划分正确,技术债务已识别。Phase 5 需要补充的两项(SubAgentRun 缓存重建 + 敏感数据脱敏)不阻塞本次 PR 合并,但进入生产前必须处理。

### 建议

1. **立即修复 3 个 P0**(预计 30 分钟) → 解除 build 阻塞
2. **修复 4 个 P1**(预计 1 小时) → 消除运行时隐患
3. **验证**: 重跑 `npm run lint` + `npx tsx scripts/phase-4-full-verify.ts` + `npm run build`
4. **合并后**: 启动 Phase 5 计划,优先处理 SubAgentRun 缓存重建和敏感数据脱敏

---

## 📎 附件

- [硬层审查完整报告](docs/reviews/PR-phase4-hil-persistence-code-reviewer.md)
- [软层审查完整报告](docs/reviews/PR-phase4-hil-persistence-ai-mentor.md)
- [Phase 4 数据库设计文档](docs/ai/phase-4-db-schema-design.md)
- [Phase 4 功能验证脚本](scripts/phase-4-full-verify.ts)
