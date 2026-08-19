# Phase 0 - Pi Runtime Spike

验证 Pi Coding Agent SDK 的核心能力，为 Work Agent 集成做准备。

## 前置条件

### 1. Node.js 版本要求

⚠️ **必须使用 Node.js >= 22.19.0**

```bash
# 检查当前版本
node -v

# 如果是 20.x，需要升级到 22.x
nvm install 22
nvm use 22
```

### 2. 环境变量

```bash
# 确保 OPENAI_API_KEY 已设置
export OPENAI_API_KEY="sk-..."
```

## 测试清单

| 测试 | 文件 | 验证内容 |
|------|------|----------|
| ✅ Test 1 | `01-basic-session.mjs` | 基础会话创建 + 事件流 |
| ✅ Test 2 | `02-extension-tool-intercept.mjs` | Extension 拦截 tool_call |
| ✅ Test 3 | `03-custom-tool.mjs` | 注册自定义 ProjectHub 工具 |
| ✅ Test 4 | `04-lifecycle-control.mjs` | abort/followUp/steer API |
| ✅ Test 5 | `05-session-resume.mjs` | Session 持久化和恢复 |
| ✅ Test 6 | `06-workspace-isolation.mjs` | 工作区隔离 |

## 运行测试

### 运行所有测试

```bash
cd scripts/phase-0-pi-spike
./run-all.sh
```

### 单独运行某个测试

```bash
cd scripts/phase-0-pi-spike
node 01-basic-session.mjs
```

## 关键发现

### Node.js 版本要求

- **Pi SDK 要求**: Node.js >= 22.19.0
- **原因**: 内部依赖 `undici` v7，与 Node 20 的内置版本冲突
- **解决**: 升级到 Node 22.23.2

### API 变化

- ❌ `prompt()` 方法已弃用
- ✅ 使用 `sendUserMessage()` 替代

### Extension 机制

```javascript
const extension = {
  name: 'my-extension',
  async onAgentSessionCreated(extensionApi) {
    // Hook events
    extensionApi.on('tool_call', async (event) => {
      // Intercept and modify
    });
    
    // Register custom tools
    extensionApi.registerTool({
      name: 'custom_tool',
      execute: async (params) => { ... }
    });
  }
};
```

## 下一步

Phase 0 验证完成后，进入 **Phase 1 - Work Agent 最小闭环**。

参考: `/docs/ai/work-agent-pi-integration-plan.md`
