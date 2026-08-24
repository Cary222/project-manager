# AI Workspace /api/sessions/[id]/state 404 Bug 修复

## 问题现象

修复完跳转首页 bug 后，AI Workspace 页面能正常加载，但浏览器控制台仍持续报：

```
[browser] Failed to load agent state: Error: HTTP 404
    at useAgentSession.useCallback[loadSession] (features/ai/ui/ai-workspace/hooks/useAgentSession.ts:499:33)
GET /api/sessions/01a01d36-73a3-798e-a697-88f6de0e42a0/state 404
GET /api/sessions/01a01d67-2a1d-7ed6-be66-43688b3ef9ea/state 404
```

虽然 404 被 `try/catch` 吞掉不影响主流程，但每次切换/加载 session 都会触发错误日志，说明后端缺少配套路由。

## 根因

客户端 `useAgentSession.ts:498` 调用：

```typescript
const stateRes = await fetch(`/api/sessions/${encodeURIComponent(sid)}/state`);
```

但 `app/api/sessions/` 下只有：
- `route.ts`（列表 GET）
- `[id]/route.ts`（单 session GET）

**没有 `[id]/state/route.ts`** —— 子路由缺失，所以全部返回 404。

这是从 pi web 移植时漏写一个 API 路由。原始 pi 应该有 `/state` 端点，本项目移植时只搬运了客户端 hook 和 `get_state` RPC 命令（`lib/rpc-manager.ts:506`），但忘了实现 HTTP 端点。

## 修复

新增 `app/api/sessions/[id]/state/route.ts`：

- 调 `requireSession()` 保持与其他路由一致的认证
- `getRunningRpcSessionIds()` 判断 session 是否在此 server 上运行
- running 时调 `getRpcSession(id).send({ type: "get_state" })` 取 live state
- idle / disk-only session 返回 `{ running: false, state: null }`，让客户端走 `else if (!agentState.running)` 分支清空 queuedMessages
- `dynamic = "force-dynamic"` 与其他 pi API 路由保持一致

返回的 `AgentStateResponse` 字段（`contextUsage` / `systemPrompt` / `thinkingLevel` / `extensionStatuses` / `extensionWidgets` / `queuedMessages`）就是 `lib/rpc-manager.ts:506` `get_state` 命令的产物，无需额外适配。

## 验证

```bash
$ curl -b cookies http://localhost:3003/api/sessions/01a01d36.../state
{"running":false,"state":null}

$ curl -b cookies http://localhost:3003/api/sessions/01a01d67.../state
{"running":false,"state":null}
```

浏览器刷新 AI Workspace 后，控制台不再出现 `Failed to load agent state` 错误。

## 关联文件

- 新增：`app/api/sessions/[id]/state/route.ts`
- 调用方：`features/ai/ui/ai-workspace/hooks/useAgentSession.ts:498`
- 数据源：`lib/rpc-manager.ts:506`（`get_state` 命令）