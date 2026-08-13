# WebSocket 连接失败诊断

## Phase 3 — 假设列表

1. **Token 格式错误**：特殊字符未编码导致 URL 解析失败
2. **DashScope 拒绝浏览器直连**：CORS 或握手协议拒绝
3. **MaaS API Key 不支持 WebSocket**：`sk-sp-` 开头的 Key 可能不支持 WebSocket 认证
4. **Region 提取错误**：`extractRegion` 返回错误的 region
5. **浏览器安全策略阻止 WSS**：HTTP 页面直连 WSS 或证书问题

## Phase 4 — 诊断日志已添加

### 修改文件

| 文件 | 位置 | 诊断内容 |
|------|------|----------|
| `use-voice-session.ts` | 行 184 | `[DEBUG-ws]` 打印连接 URL（Token 已 Redacted） |
| `use-voice-session.ts` | 行 328-333 | `[DEBUG-ws]` 增强 `ws.onerror` 日志（event、readyState、URL） |
| `dashscope.ts` | 行 63-65 | `[DEBUG-ws]` 打印 MaaS WebSocket URL（Token 已 Redacted）+ `encodeURIComponent` |

### 关键改动

1. **Token 编码修复**：`dashscope.ts:63` 添加了 `encodeURIComponent(credential.apiKey)`
2. **完整错误上下文**：`ws.onerror` 现在包含 event 对象、readyState 和 URL

## 用户需要收集的信息

### 1. 浏览器控制台（必须）

打开浏览器开发者工具 → Console，搜索 `[DEBUG-ws]`，记录：

```
[DEBUG-ws] Token Plan MaaS WebSocket URL: wss://dashscope.cn-xxx.aliyuncs.com/...?token=<REDACTED>
[DEBUG-ws] 连接 WebSocket: wss://dashscope.cn-xxx.aliyuncs.com/...?token=<REDACTED>
[DEBUG-ws] WebSocket error event: ...
[DEBUG-ws] WebSocket readyState: ...
```

### 2. Network 面板（必须）

在 WebSocket 请求上查看：
- **Status Code**：握手响应（通常是 101 或 4xx）
- **Response Headers**：有无 `Sec-WebSocket-Accept` 或 CORS 相关头
- **General → Request URL**：确认域名格式正确

### 3. 终端日志（必须）

服务启动后查看控制台输出：

```
[realtime] Token Plan MaaS WebSocket URL: wss://dashscope.cn-xxx.aliyuncs.com/...?token=<REDACTED>
```

## 预期诊断信号

| 假设 | 诊断信号 |
|------|----------|
| 假设1 Token 格式 | URL 中的 `<REDACTED>` 部分看起来正常，但连接仍失败 → 编码可能不够 |
| 假设2 DashScope 拒绝 | 浏览器 Console 有 CORS 错误或 Network 显示 4xx/5xx |
| 假设3 MaaS Key 不支持 | Network 显示 401 Unauthorized |
| 假设4 Region 错误 | URL 显示 `dashscope.cn-UNKNOWN.aliyuncs.com` |
| 假设5 安全策略 | Console 显示 Mixed Content 或证书错误 |

## 下一步

1. 用户执行 `npm run build` 并重启服务
2. 用户刷新浏览器并触发语音会话
3. 用户将上述三类信息提供给开发者
4. 开发者根据诊断信号确定根因

## Phase 5 — 根因确认与修复

### 根因

**假设 3 验证通过**：Token Plan MaaS Key (`sk-sp-`) 无法访问标准 DashScope WebSocket 端点。

浏览器日志显示：
```
token=sk-sp-H.DDMDRM.8SQg...  (Token Plan MaaS Key)
url=wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/realtime
```

**原因**：
- MaaS 的 HTTP 端点 (`token-plan.cn-beijing.maas.aliyuncs.com`) 不等于 WebSocket 端点
- `sk-sp-` Key 的鉴权协议与标准 DashScope (`/realtime/oauth2/token`) 不同
- 浏览器直连 DashScope WebSocket 时使用 MaaS Key，导致 401 Unauthorized

### 修复方案

1. **`credentials.ts:148-162`**：禁止 MaaS 用于 `realtime` 能力
   - `resolveFromAvailableModels` 中检测到 MaaS 时，如果请求 `realtime` 能力，直接跳过并记录日志

2. **`dashscope.ts:58-64`**：返回明确的用户友好错误
   - MaaS 检测到后立即抛出错误，告知用户需要标准 DashScope Key

3. **`credentials.ts:getKnownMaaSModel`**：移除 `realtime` 和 `stt` 映射
   - `getKnownMaaSModel` 只返回 TTS 模型，`realtime`/`stt` 返回 `null`

### 修改文件清单

| 文件 | 行数 | 改动 |
|------|------|------|
| `features/ai/audio/credentials.ts` | 148-162 | MaaS 检测时跳过 `realtime` |
| `features/ai/audio/credentials.ts` | 340-351 | `getKnownMaaSModel` 只返回 TTS |
| `features/ai/audio/realtime/dashscope.ts` | 58-64 | MaaS 直接抛错，不尝试连接 |

### 用户操作

1. 在系统设置中添加标准 DashScope API Key（`sk-` 开头）
2. 获取方式：https://platform.qianwenai.com/home/api-keys
3. 删除或保留 Token Plan MaaS Key（TTS 语音合成仍然可用）

### 验证修复

修复后，用户触发语音输入时应看到明确错误提示：

```
Token Plan MaaS Key 不支持 Realtime WebSocket。MaaS 的 sk-sp- Key 无法访问标准 DashScope WebSocket 端点。请在系统设置中添加标准 DashScope API Key（sk- 开头）以使用实时语音功能。获取方式：https://platform.qianwenai.com/home/api-keys
```
