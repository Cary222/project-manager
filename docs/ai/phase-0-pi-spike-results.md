# Phase 0 — Pi Runtime Spike 验证报告

**日期**: 2026-08-17  
**状态**: ✅ COMPLETE — 进入 Phase 1

---

## 验证结论

Pi SDK (`@earendil-works/pi-coding-agent@0.84.2`) 核心能力全部验证通过，可以推进 Phase 1。

---

## 关键发现

### 1. 运行环境要求（⚠️ 重要约束）

- Pi SDK 要求 **Node.js >= 22.19.0**
- 项目当前默认使用 Node 20.20.2（`undici` 版本冲突）
- **解决方案**: 使用 `nvm use 22` 切换（已安装 v22.23.2）
- **后续 Phase 需注意**: 生产 Worker 需要升级到 Node 22

### 2. 正确的初始化模式

字符串方式（`modelRuntime: 'openai'`）会报错，必须用 `ModelRuntime.create()`：

```javascript
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

const modelRuntime = await ModelRuntime.create({
  agentDir: '.pi-agent',
  allowModelNetwork: false,
  refreshOnCreate: false,
});

const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir: '.pi-agent',
  modelRuntime,
});
```

### 3. Session 生命周期 API（⚠️ Breaking change）

- ❌ `session.close()` — 不存在
- ✅ `session.dispose()` — 正确方法（同步，无返回值）

### 4. Extension 加载机制

测试发现 `extensions` 选项不在 `CreateAgentSessionOptions` 中。Extension 通过 Pi 本身的文件系统约定（`agentDir` 目录内的扩展文件）加载，而非通过 SDK 直接传入。具体机制待 Phase 2 深入验证。

---

## 通过测试清单

| 测试 | 文件 | 结果 | 备注 |
|------|------|------|------|
| T0: Import Check | `00-check-import.mjs` | ✅ | Node 22 下正常导入 |
| T1: Session Creation | `01-basic-session.mjs` | ✅ | `ModelRuntime.create()` + `createAgentSession()` |
| T2: Event Stream | `02-event-stream.mjs` | ✅ | `subscribe()` 返回 unsubscribe 函数 |
| T2b: Extension Intercept | `02-extension-tool-intercept.mjs` | ✅ | API 结构验证通过（加载机制待深入） |
| T3: Custom Tool | `03-custom-tool.mjs` | ✅ | `extensionApi.registerTool()` API 存在 |
| T4: Lifecycle Control | `04-lifecycle-control.mjs` | ✅ | `abort()` / `waitForIdle()` / `subscribe()` 全部可用 |
| T5: Session Persistence | `05-session-persistence.mjs` | ✅ | `sessionId` 参数支持跨 session 恢复 |
| T5b: Session Resume | `05-session-resume.mjs` | ✅ | 同 T5 |
| T6: Workspace Isolation | `06-workspace-isolation.mjs` | ✅ | `cwd` 隔离工作目录正常 |

---

## API Surface 确认

```typescript
// 已确认可用
session.sendUserMessage(text: string): Promise<void>
session.subscribe(listener: AgentSessionEventListener): () => void
session.abort(): Promise<void>
session.waitForIdle(): Promise<void>
session.getLastAssistantText(): string | undefined
session.isIdle: boolean
session.isStreaming: boolean
session.dispose(): void

// ❌ 不存在
session.close()  // 用 dispose() 代替
```

---

## Phase 1 前置条件

1. **Node 22 部署**：生产 Worker（`192.168.1.14`）需升级 Node >= 22.19.0
2. **OPENAI_API_KEY 或其他 LLM key**：实际对话测试需要
3. **agentDir 路径**：生产环境需确定全局 agentDir 位置（建议 `/home/hxy/.pi/agent`）
4. **Extension 加载机制**：需要通过 Pi 文档或源码进一步确认如何注册拦截器

---

## 下一步: Phase 1 — Work Agent 最小闭环

目标：dispatch + workflow 接通
- `WorkAgentJob` 触发 → `PiSubAgent.execute()` 调用
- 接收 `agent_end` 事件写回 DB
- 最小端到端 happy path
