# 语音输入无文字生成问题诊断

## 根因分析

### 问题 1：服务运行的是旧代码（主要问题）

**现象**：
- 日志显示 URL 为：`wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime`
- 新代码应为：`wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/realtime`

**分析**：
服务进程 PID 15027 仍在运行修改前的代码，没有重新构建和启动。

### 问题 2：STT 能力判断日志异常

**现象**：
```
[voice-credential] Token Plan MaaS 不支持 stt，跳过
[voice-credential] Token Plan MaaS 使用已知模型: qwen-audio-3.0-realtime-plus (realtime)
```

**分析**：
- `getKnownMaaSModel("stt")` 应返回 `"qwen-audio-3.0-realtime-plus"`
- 日志显示 "不支持 stt" 说明 `getKnownMaaSModel("stt")` 返回了 `null`
- 这可能是因为旧代码中没有正确处理 stt 能力

### 代码检查结果

1. **`use-voice-session.ts`** ✅ 代码逻辑正确
   - `mode: "input"` 配置了 `input_audio_transcription: { model: "fun-asr" }`
   - `onTranscript` 回调正确处理 `conversation.item.input_audio_transcription.completed`
   - `finishInput()` 正确发送 `input_audio_buffer.commit` + `response.create`

2. **`dashscope.ts`** ⚠️ URL 路径问题
   - 新代码使用 `/api-ws/v1/realtime`
   - 旧代码使用 `/api-ws/v1/services/audio/realtime`

3. **`credentials.ts`** ⚠️ 需验证
   - `getKnownMaaSModel("stt")` 应返回 `"qwen-audio-3.0-realtime-plus"`
   - 需重启服务后验证

## 解决方案

### 步骤 1：重启服务（必须）

```bash
# 1. 杀掉旧进程
kill -9 15027

# 2. 重新构建
cd /Users/vastgui/Desktop/project-manager
npm run build

# 3. 启动新服务
NODE_ENV=production PORT=3003 npm start
```

### 步骤 2：强制刷新浏览器

```
Cmd + Shift + R (macOS)
Ctrl + Shift + R (Windows/Linux)
```

### 步骤 3：验证新日志

重启后，新的日志应显示：
```
[realtime] Token Plan MaaS 模式: model=qwen-audio-3.0-realtime-plus, url=wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/realtime?model=...
```

注意：**`/api-ws/v1/realtime`** 而不是 `**/services/audio/realtime**`

## 验证步骤

### 1. 检查终端日志 URL

重启后，查看终端日志，确认 URL 路径为 `/api-ws/v1/realtime`：
```
[realtime] Token Plan MaaS 模式: model=qwen-audio-3.0-realtime-plus, url=wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/realtime?model=...
```

### 2. 检查浏览器控制台

1. 打开浏览器控制台（F12）
2. 点击语音输入按钮
3. 检查是否有以下日志：
   - `[useVoiceSession] Config 响应: 200`
   - `[useVoiceSession] WebSocket 已连接，发送 session.update`
   - `[useVoiceSession] 收到事件: session.created`
   - `[useVoiceSession] 收到事件: conversation.item.input_audio_transcription.completed`

### 3. 检查是否收到 transcription 事件

如果语音输入成功，控制台应显示：
```
[useVoiceSession] 收到事件: conversation.item.input_audio_transcription.completed
```

## 预期行为

修复后，用户点击语音输入按钮并说话：
1. WebSocket 连接成功建立
2. 音频数据发送到服务器
3. 服务器返回 `conversation.item.input_audio_transcription.completed` 事件
4. 文字显示在输入框中

## 如果问题仍然存在

1. **检查 WebSocket 连接**：确认没有 CORS 错误或连接被拒绝
2. **检查音频权限**：确认浏览器已授权麦克风权限
3. **检查网络**：确认能访问 `wss://dashscope.cn-beijing.aliyuncs.com`

---
*诊断时间：2026-08-12 17:45*
