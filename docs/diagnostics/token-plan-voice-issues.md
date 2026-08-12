# Token Plan MaaS 语音服务诊断报告

**日期**: 2026-08-11  
**诊断目标**: STT（语音识别）和 Realtime（实时语音对话）故障

---

## 问题总结

### 问题 1: STT 语音识别失败 ✅ 已修复

**错误日志**:
```
[voice-credential] 从 openai 获取模型列表失败: [openai] 获取模型列表失败: HTTP 404
语音识别服务未配置。请在「设置 > AI Providers」中添加支持 ASR 的 provider
```

**根本原因**:
1. `credentials.ts:342` 中 `getKnownMaaSModel("stt")` 返回 `null`
2. 回退到动态发现模型，但 `/v1/models` 端点在 Token Plan 返回 404
3. 导致 STT 凭证解析失败

**修复方案**:
```diff
// features/ai/audio/credentials.ts
case "stt":
-  // Token Plan MaaS 没有独立的 STT 模型，回退到 dashscope
-  return null;
+  // Token Plan MaaS 支持异步 STT，使用 qwen3-asr 系列
+  return "qwen3-asr-flash-filetrans";
```

**修复后的行为**:
- Token Plan MaaS 使用 `qwen3-asr-flash-filetrans` 模型
- 异步 API 流程：提交任务 → 轮询状态 → 获取结果
- 使用 `multipart/form-data` 上传音频文件

---

### 问题 2: Realtime WebSocket 连接失败 ⚠️ 需要协议适配

**错误日志**:
```
[realtime] Token Plan MaaS 模式: model=qwen-audio-3.0-realtime-plus
WebSocket 连接错误
```

**根本原因**:
前端使用 **OpenAI Realtime API 协议**，但 Token Plan MaaS 使用 **DashScope 原生协议**。

**协议对比**:

| 特性 | OpenAI Realtime | DashScope Realtime |
|------|----------------|-------------------|
| 连接格式 | `wss://api.openai.com/v1/realtime` | `wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime` |
| 鉴权 | 头部 `Authorization` | Query 参数 `?api_key=...` |
| 消息格式 | `{"type": "input_audio_buffer.append", "audio": "..."}` | `{"header": {"action": "audio_in"}, "payload": {"audio": "..."}}` |
| 会话初始化 | `session.created` → `session.update` | `{"header": {"action": "audio_start"}}` |

**修复方案（两种选择）**:

#### 选项 A: 适配 DashScope 协议（推荐）

需要修改 `features/ai/ui/hooks/use-voice-session.ts`：

```typescript
// 连接后发送初始化消息
ws.onopen = async () => {
  ws.send(JSON.stringify({
    header: {
      action: "audio_start",
      streaming: "duplex"
    },
    payload: {
      model: "qwen-audio-3.0-realtime-plus",
      parameters: {
        language: "zh-CN"
      }
    }
  }));
};

// 发送音频数据
ws.send(JSON.stringify({
  header: {
    action: "audio_in"
  },
  payload: {
    audio: base64Audio
  }
}));
```

#### 选项 B: 使用标准 DashScope（非 MaaS）

如果不希望适配协议，可以添加标准 DashScope API Key，它使用标准的 Realtime 协议。

---

## 验证步骤

### STT 验证 ✅
```bash
# 录制音频后点击停止，查看终端日志
[stt] 提交异步转写任务: model=qwen3-asr-flash-filetrans
[stt] 任务已提交: task_id=xxxxx
[stt] 任务状态: SUCCESS
```

### Realtime 验证 ⚠️
需要完成协议适配后测试：
```bash
# 使用 wscat 手动测试
npm i -g wscat
wscat -c 'wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=qwen-audio-3.0-realtime-plus&api_key=sk-sp-xxx'

# 发送初始化消息
{"header":{"action":"audio_start","streaming":"duplex"}}
```

---

## 下一步行动

1. **STT**: ✅ 已修复，等待测试验证
2. **Realtime**: 
   - [ ] 决定使用选项 A（适配 DashScope 协议）或选项 B（使用标准 DashScope）
   - [ ] 如果选择 A，需要创建新的 `use-voice-session-dashscope.ts` hook
   - [ ] 如果选择 B，需要添加标准 DashScope provider

---

## 参考资源

- Token Plan MaaS 文档: https://help.aliyun.com/zh/model-studio/user-guide/token-plan
- DashScope Realtime API: https://help.aliyun.com/zh/dashscope/api/speech-generation/realtime
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime

---

## 文件修改清单

- ✅ `features/ai/audio/credentials.ts` - 添加 STT 已知模型
- ✅ `features/ai/audio/stt/dashscope.ts` - 修复 multipart/form-data 上传
- ⚠️ `features/ai/ui/hooks/use-voice-session.ts` - 待适配 DashScope 协议
