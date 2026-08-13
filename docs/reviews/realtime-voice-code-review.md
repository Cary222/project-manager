<!-- reviewer: code-reviewer (硬层) -->

## Code Review Summary

**Scope:** 语音功能代码重构 — `dashscope.ts`、`credentials.ts`、`use-voice-session.ts`、`use-speech-input.ts`

**Review Type:** Local Changes（语音功能重构）

| 维度 | 评分 | 说明 |
|------|------|------|
| TypeScript 类型安全 | B | 主要类型正确；存在 Node.js Buffer 混用问题 |
| 安全性 | D | **严重**：API Key 暴露在 URL query param 中 |
| 边界检查 | B | MaaS URL 硬编码区域；MaaS 异常回退逻辑有缺陷 |
| 性能 | C | `Buffer.toString("base64")` 内存拷贝；WebSocket 二进制帧类型未指定 |
| 错误处理 | C | 部分异步操作缺少错误边界 |
| React 规范 | B | Hooks 依赖正确；资源清理较完备 |

**总体评分：C（存在必须修复的安全和正确性问题）**

---

## Critical (Must Fix)

### 1. **[features/ai/audio/realtime/dashscope.ts:52] API Key 暴露在 WebSocket URL query param 中**

```ts
const wsUrl = `wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=${modelName}&api_key=${credential.apiKey}`;
```

- **Impact**: API Key 会出现在浏览器历史记录、服务器访问日志、代理日志、反向代理日志中。Token Plan MaaS 的凭证被明文泄露。
- **Suggestion**: WebSocket 握手时通过 Header 传递 API Key，或使用 DashScope 官方推荐的标准 OAuth2 token 交换流程（标准模式已正确实现）。

---

### 2. **[features/ai/audio/realtime/dashscope.ts:52] MaaS WebSocket URL 硬编码区域 `cn-beijing`**

```ts
const wsUrl = `wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=${modelName}&api_key=${credential.apiKey}`;
```

- **Impact**: 如果 MaaS 部署在其他区域（如 `cn-shanghai`），WebSocket 连接会失败。
- **Suggestion**: 从 `credential.baseURL` 中动态提取区域前缀。例如：从 `https://token-plan.cn-beijing.maas.aliyuncs.com` 提取 `cn-beijing`。

---

### 3. **[features/ai/audio/realtime/dashscope.ts:87] 标准 DashScope WebSocket URL 可能不正确**

```ts
const wsUrl = `wss://dashscope.cn/audio/realtime?model=${modelName}&token=${data.token}`;
```

- **Impact**: 根据 DashScope 官方文档，正确的 WebSocket URL 应为 `wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime`。当前 URL 缺少区域和完整的 API 路径前缀，可能导致连接失败。
- **Suggestion**: 使用与 MaaS 模式相同的 URL 格式（带完整区域），或从 OAuth2 token 响应中获取正确的 WebSocket URL。

---

### 4. **[features/ai/ui/hooks/use-speech-input.ts:158] Node.js `Buffer` 在 Client Component 中使用**

```ts
const buffer = Buffer.from(arrayBuffer);
```

- **Impact**: `Buffer` 是 Node.js API，在浏览器环境中不可用。虽然 Next.js client component 在大部分场景可以运行，但部署到边缘计算平台（如 Vercel Edge、Cloudflare Workers）时会失败。
- **Suggestion**: 使用 `Uint8Array` 替代：
  ```ts
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64 = btoa(String.fromCharCode(...uint8Array));
  ```

---

## Major 问题（建议修复）

### 5. **[features/ai/ui/hooks/use-voice-session.ts:74] WebSocket 未指定 `binaryType`**

```ts
const ws = new WebSocket(config.url);
```

- **Impact**: DashScope Realtime API 传输的是二进制音频帧（base64 编码的 PCM），但 WebSocket 默认 `binaryType` 是 `blob`。当前代码依赖服务端发送 JSON 文本消息，如果收到二进制帧需要手动处理。
- **Suggestion**: 明确指定 `binaryType`：
  ```ts
  const ws = new WebSocket(config.url);
  ws.binaryType = "arraybuffer";
  ```

---

### 6. **[features/ai/audio/credentials.ts:185-196] 异常回退到 MaaS 模型逻辑有缺陷**

```ts
} catch (err) {
  console.warn(`[voice-credential] 从 ${prov} 获取模型列表失败:`, err instanceof Error ? err.message : String(err));
  // 如果动态发现失败，回退到已知模型
  const fallbackModel = getKnownMaaSModel(capability);
  if (fallbackModel) {
    // ...
  }
}
```

- **Impact**: 如果 `discoverModelsFromAPI` 失败（凭证无效或网络问题），回退到 MaaS 模型可能仍然使用无效凭证，导致后续 API 调用失败。
- **Suggestion**: 动态发现失败时不应回退到 MaaS 模型；应该让整个 `resolveFromAvailableModels` 返回 `null`，由外层处理。

---

### 7. **[features/ai/audio/credentials.ts:142] Provider 过滤列表硬编码**

```ts
if (!["openai", "dashscope", "anthropic"].includes(prov)) continue;
```

- **Impact**: 如果用户配置了其他 provider（如 Azure OpenAI）的语音模型，会被静默跳过。需要手动维护列表，容易遗漏。
- **Suggestion**: 移除硬编码过滤，或将其作为"最可能支持语音的 provider"提示而非硬性排除。

---

### 8. **[features/ai/ui/hooks/use-voice-session.ts:77-136] `ws.onopen` 中音频设备初始化错误未正确处理**

```ts
ws.onopen = async () => {
  // ...
  try {
    const stream = await navigator.mediaDevices.getUserMedia({...});
    // ...
  } catch (audioErr) {
    console.error("[useVoiceSession] 音频设备初始化失败:", audioErr);
    // 仅记录错误，未通知用户或更新 UI
  }
};
```

- **Impact**: 如果用户拒绝麦克风权限或设备不可用，错误仅记录到 console，用户不知道发生了什么。
- **Suggestion**: 在 catch 中调用 `onError?.()` 通知用户，并考虑自动关闭 WebSocket 连接。

---

### 9. **[features/ai/ui/hooks/use-voice-session.ts:142-157] 缺少 `session.update` 响应处理和超时**

```ts
case "session.created":
  ws.send(JSON.stringify({
    type: "session.update",
    session: {...}
  }));
  break;
```

- **Impact**: 发送 `session.update` 后没有等待服务端确认，也没有超时处理。如果服务端拒绝配置（如不支持的 voice 或 modality），客户端不会收到错误通知。
- **Suggestion**: 监听 `session.updated` 事件处理确认，或实现重试/超时逻辑。

---

### 10. **[features/ai/ui/hooks/use-voice-session.ts:200-202] `ws.onclose` 未清理资源**

```ts
ws.onclose = () => {
  setStatus("disconnected");
};
```

- **Impact**: WebSocket 意外断开时（服务端关闭、网络中断），`mediaStream`、`audioContext`、`pcmPlayer` 等资源未清理。
- **Suggestion**: 在 `onclose` 中调用 `stopSession` 的清理逻辑，或复用现有的 `stopSession` 函数。

---

## Minor 建议（可选优化）

### 11. **[features/ai/ui/hooks/use-speech-input.ts:169] `buffer.toString("base64")` 内存效率低**

```ts
const buffer = Buffer.from(arrayBuffer);
const response = await fetch("/api/ai/audio/transcribe", {
  body: JSON.stringify({
    audio: buffer.toString("base64"),
    format,
  }),
```

- **Impact**: `Buffer.toString("base64")` 会创建完整的 base64 字符串，内存占用翻倍。可以考虑使用 `Uint8Array` + `btoa(String.fromCharCode(...))` 或在 API 层支持 `ArrayBuffer`。
- **Suggestion**: 考虑在 `/api/ai/audio/transcribe` 中支持 `multipart/form-data` 或 `application/octet-stream` 直接传输二进制数据。

---

### 12. **[features/ai/ui/hooks/use-voice-session.ts:105-129] AudioWorkletNode 未在清理时断开**

- **Impact**: `workletNode` 创建后未保存引用，`stopSession` 中无法调用 `workletNode.disconnect()`。
- **Suggestion**: 添加 `workletNodeRef` 保存引用，在 `stopSession` 中清理。

---

### 13. **[features/ai/ui/hooks/use-voice-session.ts:160-164] `conversation.item.input_audio_transcription.completed` 累积追加**

```ts
case "conversation.item.input_audio_transcription.completed":
  if (msg.text) {
    setTranscript((prev) => prev + msg.text);
    onTranscript?.(msg.text);
  }
```

- **Impact**: 如果服务端分多次发送同一个音频片段的转写文本，`prev + msg.text` 会拼接错误。
- **Suggestion**: 确认服务端行为；如果会多次发送同一片段，考虑用 `Set` 或消息 ID 去重。

---

## 正面亮点

- **凭证解析设计良好**：`credentials.ts` 完整实现了 modelRef 模式、环境变量回退、多 provider 遍历和 MaaS 端点检测，结构清晰。
- **MaaS URL 规范化**：`normalizeMaaSBaseURL` 函数正确处理了 `compatible-mode` 路径转换。
- **超时保护**：`use-speech-input.ts` 的 60 秒超时逻辑完备，防止录音持续进行。
- **设备错误分类**：`use-speech-input.ts` 对 `getUserMedia` 错误进行了详细分类（Permission denied、NotFoundError、NotReadableError 等），用户体验友好。
- **API 认证检查**：`/api/ai/audio/realtime/config` 正确实现了 `requireSession` 认证。
- **资源清理**：`stopSession` 对 `mediaStream`、`audioContext`、`pcmPlayer` 的清理逻辑正确。

---

## tsc 检查结果

```
✅ 被审查文件无 TypeScript 编译错误
```

本次审查的 5 个文件（`dashscope.ts`、`credentials.ts`、`use-voice-session.ts`、`use-speech-input.ts`）均无 tsc 编译错误。tsc 输出的错误均来自历史遗留文件（`e2e/`、`features/admin/`），与本次重构无关。

---

## 结论

**PASS_WITH_FIXES（必须修复后合入）**

本次重构在凭证解析架构和资源清理方面设计良好，但存在**必须立即修复**的安全问题：

1. **Security Critical**: API Key 暴露在 WebSocket URL 中（`dashscope.ts:52`）
2. **Correctness Critical**: MaaS WebSocket URL 硬编码区域，`cn-beijing` 外区域部署会失败
3. **Correctness Critical**: 标准 DashScope WebSocket URL 格式可能不正确

建议优先修复上述 3 个 Critical 问题后再合入主干。Major 问题可在后续迭代中处理。

---

## Next Steps

1. 修复 API Key 暴露问题 — 使用 Header 而非 query param
2. 修复 MaaS URL 区域硬编码 — 从 `credential.baseURL` 动态提取
3. 修复标准 DashScope WebSocket URL — 补全区域和路径前缀
4. 替换 `Buffer` 为 `Uint8Array`
5. 增强 `ws.onopen` 音频错误处理
6. Review 完成后由主代理合并报告
