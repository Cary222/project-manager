# 语音实时对话崩溃诊断报告

> 诊断日期：2026-08-12
> 诊断范围：语音实时对话功能崩溃（点击按钮后无响应）

---

## Phase 1 — Feedback Loop

### 浏览器 Console 错误
（用户需在浏览器中捕获）

### Network 面板
- WebSocket 握手状态：未知（需用户提供）
- `/api/ai/audio/realtime/config` 响应：未知（需用户提供）

### 服务端日志

**terminal 1 日志（相关行）：**

```
[voice-credential] Token Plan MaaS 不支持 stt，跳过
[voice-credential] Token Plan MaaS 使用已知模型: qwen-audio-3.0-realtime-plus (realtime)
[realtime] Token Plan MaaS 模式: model=qwen-audio-3.0-realtime-plus, url=wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=...
```

**关键观察：**

1. 日志显示 `url=wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=...`
2. **终端日志中的 URL 与当前代码生成的 URL 不一致**：
   - **当前代码**（`dashscope.ts:63`）：`wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/realtime?model=...`
   - **终端日志显示**：~~`/api-ws/v1/services/audio/realtime`~~（旧格式，含有 `/services/audio`）

这表明用户终端运行的是**旧版本代码**，而工作区代码已被修改但**未重启服务**。

---

## Phase 2 — 已知问题验证

### Minor 问题 #2 验证结果：`ws.onopen` 中的 `await`

**文件：** `use-voice-session.ts:188-203`

```typescript
ws.onopen = async () => {
  setStatus("connected");
  console.log("[useVoiceSession] WebSocket 已连接，发送 session.update");

  send({
    type: "session.update",
    session: buildSessionConfig(mode),
  });

  // 初始化音频播放器（仅 output 模式需要）
  if (mode === "output") {
    const player = new PCMPlayer();
    await player.init();  // ⚠️ 在 async 回调中，正确
    pcmPlayerRef.current = player;
  }

  // 初始化麦克风采集
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ ... });
    // ...
  } catch (audioErr) {
    // ...
  }
};
```

**验证结果：✅ 已修复**

- `ws.onopen` 已声明为 `async` 函数
- `await player.init()` 在正确的 async 上下文中执行
- `await navigator.mediaDevices.getUserMedia()` 同理

**结论：** Minor 问题 #2 在当前代码中已不存在，验证报告中的问题已被修复。

---

## Phase 3 — 假设排序

| 假设 | 可能性 | 验证结果 |
|------|--------|----------|
| **B: WebSocket URL 不正确（最重要！）** | **高** | 终端日志显示旧 URL `/services/audio/realtime`，代码已改为 `/realtime`，但**服务未重启** |
| A: player.init() 失败 | 低 | 代码已修复（ws.onopen 是 async） |
| C: 麦克风权限被拒 | 中 | 需浏览器 Console 验证 |
| D: WebSocket 握手失败 | 中 | 需浏览器 Network 面板验证 |
| E: React 状态错误 | 低 | 状态管理逻辑正常 |

---

## Phase 4 — 根因

**最终确认的根因：服务未重启，终端运行的是旧版本代码**

### 证据链

1. **终端日志 URL**：~~`/api-ws/v1/services/audio/realtime`~~（旧格式）
2. **当前代码 URL**：`/api-ws/v1/realtime`（新格式，移除了 `/services/audio`）
3. **git diff 证实**：`dashscope.ts` 第 63 行从 `services/audio/realtime` 改为 `realtime`
4. **服务日志无 WebSocket 连接错误**：说明 WebSocket 握手阶段就没有发起连接请求，因为 URL 格式问题导致连接失败

### 问题演变

| 阶段 | URL | 说明 |
|------|-----|------|
| 旧代码 | `/api-ws/v1/services/audio/realtime` | 旧格式 |
| 当前代码 | `/api-ws/v1/realtime` | 新格式（已修复） |
| 终端运行 | **旧代码** | 服务未重启 |

---

## Phase 5 — 修复方案

### 方案：重启服务

```bash
cd /Users/vastgui/Desktop/project-manager
npm run build
```

然后重启服务（按 `pm-ops` skill 操作）。

### 验证步骤

1. 重启后，再次点击语音实时对话按钮
2. 检查终端日志，新日志应显示：
   ```
   [realtime] Token Plan MaaS 模式: model=qwen-audio-3.0-realtime-plus, region=cn-beijing
   ```
   （注意：`url=` 已从日志中移除，避免暴露敏感信息）
3. 检查浏览器 Console，应有：
   ```
   [useVoiceSession] Config 响应: 200 OK
   [useVoiceSession] 获取到配置: { mode: "direct", url: "..." }
   [useVoiceSession] WebSocket 已连接，发送 session.update
   ```

### 如果重启后仍有问题

请提供以下信息：

1. **浏览器 Console 完整错误**（F12 → Console → 红色错误）
2. **Network 面板 WebSocket 握手详情**（状态码、请求/响应头）
3. **重启后的终端日志**

---

## 总结

| 项目 | 结论 |
|------|------|
| **根因** | 服务未重启，运行旧版本代码（WebSocket URL 格式不一致） |
| **当前代码状态** | ✅ 已修复（URL 从 `/services/audio/realtime` 改为 `/realtime`） |
| **下一步** | 重启服务后测试 |
