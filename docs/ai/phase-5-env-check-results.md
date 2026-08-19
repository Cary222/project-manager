# Phase 5 环境验证结果

> **验证时间**: 2026-08-19 13:40  
> **验证目标**: 确认远程开发机 (`hxy@192.168.1.14`) 是否满足 Phase 5 实施条件

---

## ✅ 通过的检查项

| 检查项 | 状态 | 详情 |
|--------|------|------|
| **Node.js 版本** | ✅ | v22.22.2 (满足 >= 22.19.0 要求) |
| **Node.js 安装方式** | ✅ | 系统包管理器 (`/usr/bin/node`) |
| **Pi SDK 依赖** | ✅ | `@earendil-works/pi-coding-agent@0.84.2` 已安装 |
| **磁盘空间** | ✅ | 1.1TB 可用空间（远超 1GB 最低要求）|
| **项目结构** | ✅ | `/home/hxy/work/personal/project-manager/` 存在 |
| **生产环境配置** | ✅ | `.env.production` 存在 |

---

## ⚠️ 需要解决的问题

### 问题 1: Pi SDK 如何使用数据库中的 API Key (已解决)

**现状**:
- ✅ 用户配置了 DeepSeek API key（UI 显示 "deepseek-v4-flash"）
- ✅ `resolveCredential(userId, "deepseek")` 可以获取解密后的 key
- ✅ Pi SDK 支持通过环境变量配置 LLM provider

**解决方案**:

Pi SDK 会自动读取环境变量，因此我们可以在启动 session 前设置：

```typescript
// 在 features/ai/agents/work/subagents/pi/transports/sdk.ts 中

async start(input: PiStartInput): Promise<string> {
  // 1. 从数据库获取用户凭证
  const cred = await resolveCredential(input.userId, input.provider || "deepseek");
  if (!cred) {
    throw new Error(`No API key found for provider "${input.provider || "deepseek"}"`);
  }
  
  // 2. 设置环境变量（Pi SDK 会读取）
  process.env.OPENAI_API_KEY = cred.apiKey;  // DeepSeek 兼容 OpenAI 格式
  
  // 3. 如果是 DeepSeek，需要设置 baseURL
  if (input.provider === "deepseek" || cred.baseURL.includes("deepseek")) {
    process.env.OPENAI_API_BASE_URL = cred.baseURL;
  }
  
  // 4. 创建 Pi session
  const { session } = await createAgentSession({ ... });
  
  // ...
}
```

**优势**:
- 复用现有 `resolveCredential()` 逻辑，无需新增表或配置
- 支持多 provider（DeepSeek / OpenAI / Anthropic）
- 用户无需为 Pi SDK 单独配置 API key

**Priority**: ✅ **已解决**，在 P0 实施时会集成

---

### 问题 2: 缺少 Pi agentDir (P1 推荐)

**现状**:
- ❌ `~/.pi/` 目录不存在
- Pi SDK 默认会在项目目录下创建 `.pi-agent/`，但可能导致：
  - 每个项目独立的 agent 配置（无法复用 model cache）
  - 占用项目目录空间

**影响**:
不影响功能，但可能影响性能（每次都重新下载 model）。

**解决方案**:

```bash
# 创建全局 Pi agentDir
ssh hxy@192.168.1.14 'mkdir -p /home/hxy/.pi/agent'

# 在代码中配置:
const modelRuntime = await ModelRuntime.create({
  agentDir: process.env.PI_AGENT_DIR || '/home/hxy/.pi/agent',
  allowModelNetwork: false,
  refreshOnCreate: false,
});
```

**优先级**: P1（可以延后到实际运行时再创建）

---

### 问题 3: Phase 0 测试脚本未同步到远程 (P2 影响验证)

**现状**:
- ❌ 远程开发机没有 `scripts/phase-0-pi-spike/` 目录
- 本地 Mac 有该目录（用于 Phase 0 验证）

**影响**:
无法在远程开发机上直接运行 Phase 0 的验证脚本。

**解决方案**:

```bash
# 方案 A: 从本地推送到远程
cd /Users/vastgui/Desktop/project-manager
git add scripts/phase-0-pi-spike/
git commit -m "Add Phase 0 Pi SDK verification scripts"
git push origin main

# 远程开发机拉取
ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && git pull'

# 方案 B: 直接 scp 上传（更快）
scp -r scripts/phase-0-pi-spike/ hxy@192.168.1.14:/home/hxy/work/personal/project-manager/scripts/
```

**优先级**: P2（可以先用简化版测试脚本）

---

### 问题 4: nvm 未配置 (P2 不影响功能)

**现状**:
- ❌ nvm 未安装或未加载到 PATH
- ✅ Node.js 通过系统包管理器安装（`/usr/bin/node`）

**影响**:
无法通过 nvm 切换 Node 版本，但当前版本 (v22.22.2) 已满足要求。

**解决方案**:
不需要处理，系统 Node.js 版本符合要求。

---

## 🚀 Phase 5 启动前置条件

### ✅ 已解决 (无需操作)
- [x] **LLM API Key**: 用户已在数据库配置 DeepSeek key，Phase 5 会通过 `resolveCredential()` 读取

### 推荐完成 (P1)
- [ ] **创建全局 Pi agentDir** (`/home/hxy/.pi/agent`)

### 可选 (P2)
- [ ] 同步 Phase 0 测试脚本到远程

---

## 📝 快速启动指南

### Step 1: 配置 API Key

```bash
# 登录远程开发机
ssh hxy@192.168.1.14

# 创建 .env 文件（如果使用 OpenAI）
cd /home/hxy/work/personal/project-manager
echo "OPENAI_API_KEY=sk-proj-你的key" >> .env

# 或者使用 DeepSeek（国内）
echo "DEEPSEEK_API_KEY=sk-你的key" >> .env
```

### Step 2: 创建 Pi agentDir（推荐）

```bash
mkdir -p /home/hxy/.pi/agent
```

### Step 3: 验证环境

```bash
# 测试 Node 版本
node --version  # 应该输出 v22.22.2

# 测试 Pi SDK 安装
cd /home/hxy/work/personal/project-manager
node -e "import('@earendil-works/pi-coding-agent').then(() => console.log('✅ Pi SDK OK'))"
```

### Step 4: 运行简化版验证脚本

在本地创建 `scripts/phase-5-quick-verify.mjs`:

```javascript
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

async function quickVerify() {
  console.log('🧪 Phase 5 Quick Verification');
  
  try {
    // 1. 创建 ModelRuntime
    console.log('\n1️⃣ Creating ModelRuntime...');
    const modelRuntime = await ModelRuntime.create({
      agentDir: process.env.PI_AGENT_DIR || '.pi-agent',
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    console.log('✅ ModelRuntime created');
    
    // 2. 创建 Session
    console.log('\n2️⃣ Creating Agent Session...');
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: '.pi-agent',
      modelRuntime,
    });
    console.log('✅ Agent Session created');
    
    // 3. 发送简单消息
    console.log('\n3️⃣ Sending test message...');
    await session.sendUserMessage('Say "Hello from Pi SDK"');
    
    // 等待响应
    await session.waitForIdle();
    
    const response = session.getLastAssistantText();
    console.log('✅ Got response:', response?.substring(0, 100));
    
    // 4. 清理
    session.dispose();
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

quickVerify();
```

上传到远程并运行:

```bash
# 上传脚本
scp scripts/phase-5-quick-verify.mjs hxy@192.168.1.14:/home/hxy/work/personal/project-manager/scripts/

# 远程运行
ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && node scripts/phase-5-quick-verify.mjs'
```

---

## ✅ 环境验证总结

| 类别 | 状态 | 备注 |
|------|------|------|
| **Node.js 版本** | ✅ | v22.22.2 符合要求 |
| **Pi SDK 安装** | ✅ | 0.84.2 已安装 |
| **磁盘空间** | ✅ | 1.1TB 可用 |
| **LLM API Key** | ⚠️ | **需要配置** (P0 阻塞) |
| **Pi agentDir** | ⚠️ | 建议创建 (P1 推荐) |
| **测试脚本** | ⚠️ | 需要同步或创建 (P2 可选) |

**下一步**: 配置 LLM API Key 后，即可开始 Phase 5 实施。
