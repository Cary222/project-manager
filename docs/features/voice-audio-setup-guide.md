# 语音功能配置指南

> 语音输入、语音对话、语音朗读功能需要配置 DashScope API Key 才能使用。

---

## 一、错误提示说明

如果看到以下错误：

```
DashScope 语音服务未配置。请在「设置 > AI Providers」中添加 dashscope 提供商，或联系管理员配置系统默认密钥。
```

或者：

```
未检测到麦克风设备。请检查麦克风是否已连接。
```

```
请允许麦克风权限。请在浏览器设置中启用麦克风访问。
```

请按照以下步骤配置。

---

## 二、配置 DashScope API Key

### 重要说明

**provider 名称必须是 `dashscope`**，不能是 `openai` 或其他名称。

> ⚠️ 如果你使用 Token Plan MaaS（`token-plan.cn-beijing.maas.aliyuncs.com`），语音 API 需要使用专用 Base URL，请看「Token Plan 用户配置」部分。

### 方案 A：管理员配置系统默认（推荐）

**适用场景**：所有用户共享同一个 API Key

**步骤**：

1. **登录 ROOT 账号**
2. **进入 AI Providers 管理页面**
   - 路径：`设置 > AI Providers`
3. **添加 DashScope 提供商**
   - 点击「添加提供商」
   - **提供商**：`dashscope`（必须）
   - **API Key**：从阿里云获取（见下方）
   - **Base URL**：
     - 标准 DashScope 用户：留空（自动使用 `https://dashscope.aliyuncs.com/api/v1`）
     - Token Plan MaaS 用户：填 `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`
   - **传输方式**：`direct`
4. **保存配置**

配置后，所有用户即可使用语音功能。

### 方案 B：用户自定义配置

**适用场景**：用户使用自己的 API Key

**步骤**：

1. **进入个人设置**
   - 路径：`设置 > AI Providers`
2. **添加 DashScope**
   - **提供商**：`dashscope`（必须）
   - **API Key**：输入你的 API Key
   - **Base URL**：
     - 标准 DashScope 用户：留空
     - Token Plan MaaS 用户：填 `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`
   - **传输方式**：`direct`
3. **保存配置**

**优先级**：用户自定义 > 系统默认 > 环境变量

---

## 三、Token Plan MaaS 用户配置

如果你使用的是 Token Plan（`sk-sp-xxx` 格式的 API Key），需要配置专用的 Base URL：

### Token Plan Base URL

```
https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
```

### 配置步骤

1. **进入 AI Providers**
2. **添加/编辑 dashscope provider**
3. **填写配置**：
   - **提供商**：`dashscope`
   - **API Key**：你的 Token Plan API Key（`sk-sp-xxx` 开头）
   - **Base URL**：`https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`
   - **传输方式**：`direct`
4. **保存**

> ⚠️ **注意**：Token Plan 的兼容端点（`token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`）是**文本模型专用**，不支持语音 API。必须使用 `/api/v1` 端点。

---

## 四、获取 DashScope API Key

### 1. 访问阿里云 DashScope 控制台

https://dashscope.console.aliyun.com/

### 2. 创建 API Key

- 登录阿里云账号
- 进入「API-KEY 管理」
- 点击「创建新的 API-KEY」
- 复制生成的 Key

### 3. 确认开通服务

确保已开通以下服务：

- ✅ 通义语音（qwen-audio）
  - 语音识别（ASR）
  - 语音合成（TTS）
  - 实时语音（Realtime）

---

## 四、浏览器麦克风权限配置

### Chrome / Edge

1. 点击地址栏左侧的 🔒 或 🛡️ 图标
2. 找到「麦克风」设置
3. 选择「允许」
4. 刷新页面

### Safari

1. Safari 菜单 > 设置 > 网站 > 麦克风
2. 找到项目网站
3. 选择「允许」
4. 刷新页面

### Firefox

1. 点击地址栏左侧的 🔒 图标
2. 点击「权限」
3. 找到「使用麦克风」
4. 选择「允许」
5. 刷新页面

---

## 五、功能测试

### 1. 测试语音输入（STT）

1. 进入 AI 对话页面
2. 点击麦克风图标 🎤
3. 开始说话（最长 60 秒）
4. 停止录音
5. 检查识别结果是否自动填入输入框

**预期效果**：
- 录音中显示红点闪烁 + 时长（MM:SS）
- 停止后 1-3 秒内识别完成
- 识别文本自动填入输入框

### 2. 测试语音对话（Realtime）

1. 点击语音对话图标 🎙️
2. 开始说话
3. AI 实时回答（文字 + 语音）
4. 点击停止按钮结束

**预期效果**：
- 连接中显示加载动画
- 连接成功后显示「语音对话中」状态
- 说话实时显示识别文本
- AI 回答同步播放音频

### 3. 测试语音朗读（TTS）

1. AI 回答后，点击「朗读」按钮 🔊
2. 播放音频
3. 播放中可点击「停止」🔇

**预期效果**：
- 点击后立即开始播放
- 播放中显示停止图标
- 播放完成或手动停止后恢复朗读图标

---

## 六、常见问题

### Q1: 点击麦克风后没有反应？

**A**：检查以下项：
1. 麦克风是否已连接并正常工作
2. 浏览器是否已授予麦克风权限
3. 是否有其他应用占用麦克风（如 Zoom、Teams）
4. 尝试刷新页面后重试

### Q2: 识别结果不准确？

**A**：优化建议：
1. 确保环境安静（减少背景噪音）
2. 麦克风距离嘴巴 15-30cm
3. 说话清晰、语速适中
4. 使用高质量麦克风（推荐使用耳机麦克风）

### Q3: 语音对话延迟高？

**A**：可能原因：
1. 网络延迟（检查网络连接）
2. API 服务负载高（稍后重试）
3. 浏览器性能不足（关闭其他标签页）

### Q4: TTS 音质不好？

**A**：当前使用默认音色 `af_luona`（知性温柔女声），未来版本支持音色选择。

### Q5: 语音功能在移动端能用吗？

**A**：
- iOS Safari：支持麦克风录音，但 AudioWorklet 支持有限
- Android Chrome：完全支持
- 建议在桌面浏览器使用以获得最佳体验

---

## 七、费用说明

DashScope 语音服务按调用次数计费：

| 服务 | 计费单位 | 参考价格 |
|------|----------|----------|
| 语音识别（ASR） | 每分钟 | ¥0.01 - ¥0.05 |
| 语音合成（TTS） | 每千字符 | ¥0.02 - ¥0.10 |
| 实时语音（Realtime） | 每分钟 | ¥0.05 - ¥0.20 |

**节省费用建议**：
- 使用系统默认配置共享 API Key
- 避免长时间保持语音对话连接
- TTS 合成前检查文本长度

详细定价请参考：https://help.aliyun.com/zh/dashscope/product-overview/billing

---

## 八、技术支持

如遇到其他问题：

1. 查看浏览器控制台错误信息
2. 检查 DashScope API Key 是否有效
3. 确认 API Key 配额是否充足
4. 联系管理员或技术支持

---

**文档更新日期**：2026-08-11
**适用版本**：v1.0
