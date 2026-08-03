# Context v4 + Timeline v4 手动测试剧本

> 验收目标：Context v4（RuntimeState 持久化 + buildChatContext 重构）和 Timeline v4（节点流 SSE 推送）两条链路在实际对话中是否工作。
> 前置：dev server 在 `http://192.168.1.14:3003`，已登录 cary（刘屹鹏）账号。

---

## 测试剧本 0：烟雾测试（必跑，5 分钟）

**目的**：验证 Context v4 + Timeline v4 的最小路径不崩。

1. 新建对话，发"你好"
2. 观察 Timeline：应有 3 步（意图识别 → 选择模型 → 生成回答）
3. 验证：前端有 AI 回复文字，`mode=chat`，不触发工具调用

**判据**：✅ 有文字回复 + Timeline 3 步 + 无 500

---

## 测试剧本 1：HIL 中断恢复（P0，核心 bug 验证）

**目的**：验证 `Boolean(pendingState)` → `Boolean(pendingState?.pendingHumanAction)` 修复后，残留 pendingAction 不再劫持新消息。

### 步骤

| 轮次 | 操作 | 预期 |
|------|------|------|
| 1 | 发"刘工的周报有哪些" | 弹出 HIL 候选（5 个"刘"字用户），**不要选** |
| 2 | 直接关浏览器标签页（模拟中断） | — |
| 3 | 重新打开对话，发"你好"（chat 模式） | **直接生成回答**，不卡在 HIL（textLen > 0） |

**判据**：✅ 剧本 1 + 剧本 2（重测）都 textLen > 0
**验证命令**：

```sql
-- 验证 DB 没有残留 pendingAction
SELECT conversation_id, humanstate, updated_at
FROM pm.ai_conversation_runtime_state
WHERE conversation_id = 'cmsa6dtvd000990n4m02an02g'
ORDER BY updated_at DESC LIMIT 5;
```

**失败信号**：`[detectIntent] waiting for confirmation, skipping intent detection` + textLen=0

---

## 测试剧本 2：Search 模式 + Timeline 完整链路

**目的**：验证 search 模式触发完整 Timeline 6 步，以及 DB 写入。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | 发"我最近的工单有哪些" | Timeline ≥ 4 步（意图识别→选择模型→知识检索→生成回答） |
| 2 | 观察 Network → event-stream | 有 `timeline_snapshot` SSE 事件 |
| 3 | 看 DB | `pm.ai_conversation_runtime_state` 有写入（humanstate.lastAssistantMessage 非空） |

**判据**：✅ Timeline ≥ 4 步 + 前端有 RAG 引用 + DB 有写入

---

## 测试剧本 3：语义代词解析（跨轮缓存）

**目的**：验证第一轮选"刘屹鹏"后，第二轮"他最近干什么"不触发 HIL。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | "刘工的周报有哪些" → 选"刘屹鹏" | 查到周报 |
| 2 | "他最近在干什么" | **不弹 HIL**，直接搜 |
| 3 | 检查 DB | `semanticcontext.lastMentionedUser = {id, name:'刘屹鹏'}` |

**判据**：✅ 第二轮无 HIL 弹窗 + 直接返回结果
**失败信号**：第二轮又弹出 HIL（semantic 缓存失效）

---

## 测试剧本 4：finally flush 中断保护

**目的**：验证 SSE 中断时 `patcher.flush()` 仍写 DB。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | 发一个需要 RAG 的问题，等待回答中 | — |
| 2 | Network tab 找到 event-stream，**右键 → Cancel** | — |
| 3 | 立刻查 DB | `humanstate` 有写入（finally flush 触发） |
| 4 | 重新发同样问题 | 从断点恢复，不丢上下文 |

**判据**：✅ 中断后 DB 有数据 + 恢复后上下文不丢

---

## 测试剧本 5：id 去重（历史消息不丢）

**目的**：验证连续发相同消息，每条都有独立 id（review Critical #2）。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | 连续发 5 条"你好"（每条回车） | 前端 Timeline 有 5 个节点 |
| 2 | 新开对话 | — |
| 3 | 发"刚才我说什么了" | AI 列出 **5 条**历史 |

**判据**：✅ 5 条历史全保留
**失败信号**：只看到 1 条（id 去重 bug 复发）

---

## 测试剧本 6：多对话并发隔离

**目的**：两个对话的 RuntimeState 不互串。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | 浏览器 A 打开对话甲，发"我是甲" | 回答内容含"甲" |
| 2 | 浏览器 B（无痕）打开对话乙，发"我是乙" | 回答内容含"乙" |
| 3 | 回到对话甲，再发一条 | 甲的上下文不受乙影响 |

**判据**：✅ 甲乙上下文完全隔离

---

## 测试剧本 7：Timeline 节点状态机

**目的**：验证 Timeline UI 的 pending → running → success/error 动画。

### 步骤

| 操作 | 验证点 |
|------|--------|
| 发任意问题 | 每个节点：loading → 完成，图标/颜色正确 |
| 故意触发错误（如搜不存在的） | 节点变红 + 显示错误信息 |
| 多步并发时 | 按依赖顺序显示，无时序错乱 |

**判据**：✅ 动画流畅 + 状态切换正确

---

## 测试剧本 8：模式切换（chat ↔ search）

**目的**：验证 mode 切换不丢 lastMentionedUser。

### 步骤

| 轮次 | 操作 | 验证点 |
|------|------|--------|
| 1 | chat 问题："你好" | 不触发 RAG（Timeline 3 步） |
| 2 | 切换 search 模式，发"我最近的工单" | 触发 RAG（Timeline ≥ 4 步） |
| 3 | 切回 chat，发"他最近怎么样" | **不弹 HIL**（lastMentionedUser 保留） |

**判据**：✅ chat/search 互不影响 + 代词缓存保留

---

## 测试通过判据（验收门槛）

| 剧本 | 核心验证 | 通过阈值 |
|------|----------|----------|
| 0 | 烟雾测试 | textLen > 0，Timeline 3 步 |
| 1 | HIL 中断恢复 | textLen > 0（无残留） |
| 2 | Search + Timeline 完整 | Timeline ≥ 4 步 + DB 写入 |
| 3 | 代词解析 | 第二轮无 HIL 弹窗 |
| 4 | finally flush | 中断后 DB 有数据 |
| 5 | id 去重 | 5 条历史全保留 |
| 6 | 并发隔离 | 甲乙不互串 |
| 7 | Timeline 动画 | pending→success/error 正确 |
| 8 | mode 切换 | 代词缓存保留 |

**失败处理**：每个失败剧本单独写 `docs/qa/test-failure-<日期>.md`，含：
- 终端/Console 截图
- 预期 vs 实际行为
- 根因假设

---

## DB 监控命令（每个剧本后跑一次）

```bash
# runtime_state 全量查看
psql -h 192.168.1.14 -U pm_user -d pm_db -c \
  "SELECT conversation_id, humanstate, semanticcontext, updated_at
   FROM pm.ai_conversation_runtime_state
   ORDER BY updated_at DESC LIMIT 3;"

# 某对话的消息历史
psql -h 192.168.1.14 -U pm_user -d pm_db -c \
  "SELECT id, role, content, created_at FROM pm.ai_chat_message
   WHERE conversation_id = 'cmsa6dtvd000990n4m02an02g'
   ORDER BY created_at LIMIT 10;"
```

## 补测缺口（Vitest 单元测试，待 CI 层补）

| 测试文件 | 覆盖场景 | 状态 |
|----------|----------|------|
| `timeline-adapter.test.ts` | 4 个 callback × 3 节点 × 边界 | ❌ 零测试 |
| `runtime-state-bridge.test.ts` | bridgeRuntimeToLegacy 全路径 | ✅ 已通过 |
| `context-builder.test.ts` | stale pending guard | ❌ 零测试 |
| `history-window.test.ts` | Token 截断 + id 去重 | ❌ 零测试 |
