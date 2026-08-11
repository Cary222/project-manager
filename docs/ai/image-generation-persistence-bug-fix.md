# AI 生图持久化 Bug 修复 — 完整复现手册

> 适用：project-manager（Next.js + Prisma + LangGraph）  
> 目标：让任何同事/未来的我拿到这份文档，能**完整复现**"生图刷新后图片消失"的 bug 诊断与修复过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

**现象**：
- 用户在 AI 对话页面切换到生图模式，输入提示词生成图片
- 图片生成成功，前端正常显示
- **刷新页面**（Cmd+R / F5）后，图片消失，只剩文本消息

**业务影响**：
- 用户体验极差，每次刷新都要重新生成图片
- 图片记录无法持久化，浪费 API 调用额度
- 影响生图功能的可用性和可信度

### 1.2 结论

**根因**：`GET /api/ai/conversations/:id` API 返回消息列表时，**未包含 `attachments` 字段**。

生图流程后端已正确将图片存入 `AiFileAsset` 表，并创建 `AiMessageAttachment` 关联，但前端加载历史消息时走的是 conversations API，该 API 的 Prisma select 漏掉了 `attachments` 字段。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/store/conversation-store.ts` | 修改 | 后端：getConversationsWithMessages 添加 attachments 字段查询 |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | 前端：loadMessages 映射 attachments 到 Message 类型 |

---

## 3. 核心实现

### 3.1 Bug 诊断流程（按 diagnosing-bugs skill）

#### Phase 1 — 建立反馈循环

**问题定位**：
1. ✅ 后端生图流程正常（`POST /api/ai/generate/image` → worker → 图片入库 → `AiMessageAttachment` 创建）
2. ✅ 单条消息查询接口 `GET /api/ai/messages/[id]` 已正确返回 `attachments`
3. ❌ 批量消息查询接口 `GET /api/ai/conversations/[id]` **未返回 `attachments`**
4. ❌ 前端 `AiChatPanel` 加载历史消息时收不到 `attachments`

**数据流追踪**：

```
生图请求 → POST /api/ai/generate/image
  ↓
创建 message (executionStatus: QUEUED)
  ↓
Background worker 调用 handleImageGenerate
  ↓
图片存入 AiFileAsset 表
  ↓
创建 AiMessageAttachment (messageId + fileAssetId)
  ↓
message 状态更新为 COMPLETED
  ↓
前端刷新 → GET /api/ai/conversations/:id
  ↓
❌ 返回的 message 结构缺少 attachments 字段
  ↓
AiMessageBubble 收不到 attachments → 图片无法渲染
```

#### Phase 2 — 修复方案

**修复点 1：后端 conversation-store.ts**

```247:267:features/ai/store/conversation-store.ts
const messages = await prisma.aiChatMessage.findMany({
  where: { conversationId },
  orderBy: { createdAt: "asc" },
  take: 50,
  select: {
    id: true,
    conversationId: true,
    role: true,
    content: true,
    sources: true,
    metadata: true,
    createdAt: true,
    executionStatus: true,
    attachments: {
      select: {
        id: true,
        type: true,
        fileAssetId: true,
      },
    },
  },
});
```

**为什么这样写**：Prisma select 默认不包含关联表，必须显式声明 `attachments` 嵌套查询。

**修复点 2：前端 AiChatPanel.tsx**

```typescript
// 在 loadMessages 的 map 函数中添加：
executionStatus: m.executionStatus,
attachments: m.attachments,
```

**为什么这样写**：前端 Message 类型已支持 `attachments` 字段，但 API 响应映射时漏掉了。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | Next.js dev server |
| 数据库 | PostgreSQL schema `pm` | 生产环境 |
| 表结构 | `AiChatMessage`, `AiMessageAttachment`, `AiFileAsset` | Prisma schema |
| Worker | Background job dispatcher | 处理异步生图任务 |

---

## 5. 启动 / 部署

```bash
# 1. 确保依赖已安装
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 确保数据库连接正常
npx prisma generate

# 3. 启动 Next.js（开发模式）
npm run dev

# 4. 启动 Background Worker（另一个终端）
npx tsx worker/background/index.ts

# 5. 访问 AI 对话页面
open http://localhost:3003/ai/chat
```

---

## 6. 测试 & 验证

### 6.1 复现原 Bug（修复前）

```bash
# 1. 访问 AI 对话页面
open http://localhost:3003/ai/chat

# 2. 切换到生图模式
# 3. 输入提示词："生成一张最新白海豚台风场景图"
# 4. 等待图片生成完成（可在浏览器看到图片显示）
# 5. 刷新页面（Cmd+R）
# 期望：❌ 图片消失，只剩文本消息
```

### 6.2 验证修复后

```bash
# 1. 应用本次修复的代码
git checkout <fix-branch>

# 2. 重启 Next.js
npm run dev

# 3. 访问 AI 对话页面
open http://localhost:3003/ai/chat

# 4. 切换到生图模式
# 5. 输入提示词："生成一张最新白海豚台风场景图"
# 6. 等待图片生成完成
# 7. 刷新页面（Cmd+R）
# 期望：✅ 图片依然显示，持久化成功
```

**期望输出**：
- 刷新后 Network 面板能看到 `GET /api/ai/conversations/:id` 返回的消息包含 `attachments` 字段
- 浏览器控制台无报错
- 图片正常渲染在对话界面

---

## 7. 复现 Checklist

- [ ] 装好 Node.js 20+ 和 PostgreSQL
- [ ] 启动 Next.js dev server（端口 3003）
- [ ] 启动 Background Worker
- [ ] 访问 `/ai/chat` 页面
- [ ] 切换到生图模式
- [ ] 输入提示词并等待生成完成
- [ ] 刷新页面验证图片是否持久化
- [ ] 检查 Network 面板 API 响应是否包含 `attachments`

---

## 8. 踩坑记录

> 本次开发从零搭建生图功能到修复持久化 bug 的完整踩坑记录，按时间顺序或逻辑分组排列。

### 坑 1：`typedData` 重复声明导致 worker 启动失败

**现象**：
```
Error: Transform failed with 1 error:
/Users/vastgui/Desktop/project-manager/features/ai/llm/image-generator.ts:144:10: 
ERROR: The symbol "typedData" has already been declared
```

**原因**：`image-generator.ts` 中有两处 `const typedData = data as {...}`，esbuild 报错。

**解法**：删除第二个重复的类型断言（行 144-152）。

### 坑 2：前端类型定义不完整，TypeScript 编译报错

**现象**：`AiChatPanel.tsx` 映射 `attachments` 时，TypeScript 提示类型不匹配。

**原因**：API 响应的类型定义中缺少 `executionStatus` 和 `attachments` 字段。

**解法**：在 `loadMessages` 的 map 函数中显式声明类型：
```typescript
(m: {
  id: string;
  role: string;
  content: string;
  sources?: unknown;
  metadata?: unknown;
  executionStatus?: string;
  attachments?: Array<{
    id: string;
    type: string;
    fileAssetId: string;
  }>;
}) => ({ ... })
```

### 坑 3：只修复了 conversations API，messages API 被遗漏

**现象**：开发过程中发现 `GET /api/ai/messages/[id]` 单条消息接口**已经**包含 `attachments`。

**原因**：单条消息查询和批量查询走的是不同的 Prisma 查询，批量查询漏掉了 `attachments`。

**解法**：本次只需修复 `conversation-store.ts` 的批量查询，无需改动 `messages/[id]/route.ts`。

### 坑 4：生图 API 模型参数不匹配

**现象**：调用 DashScope Wan2.7-image API 时返回 `400 Bad Request`。

**原因**：不同生图模型的参数格式不同。按照 ai-image-generation skill，应该先确定使用哪个模型（OpenAI / DashScope / 其他），再查阅对应的 schema。

**解法**：在 `image-generator.ts` 中实现 `detectProvider` 函数，根据 `baseURL` 自动识别 provider：
- `dashscope` / `aliyuncs.com` → DashScope Wan
- `openai.com` → OpenAI DALL-E
- 其他 → 兜底处理

### 坑 5：Background Worker 未正确处理生图 Job

**现象**：生图请求发送后，前端一直显示 "生成中"，后端 worker 没有处理 job。

**原因**：Worker 的 `dispatcher.ts` 中 `IMAGE_GENERATE` job type 没有注册到 handler。

**解法**：
1. 在 `worker/background/handlers/index.ts` 注册 `handleImageGenerate`
2. 在 `worker/background/dispatcher.ts` 的 `switch` 语句中添加 `IMAGE_GENERATE` case
3. 重启 worker 进程

### 坑 6：图片 base64 存储超出数据库字段长度限制

**现象**：生成的图片无法存入 `AiFileAsset` 表，报错 `value too long for type character varying(N)`。

**原因**：Prisma schema 中 `data` 字段类型为 `String`，默认映射到 PostgreSQL 的 `VARCHAR(255)`，无法容纳大图片的 base64。

**解法**：修改 Prisma schema：
```prisma
model AiFileAsset {
  // ...
  data String @db.Text  // 使用 Text 类型，支持无限长度
}
```
然后执行 `npx prisma migrate dev`。

---

## 9. 生图功能完整流程（从零到完成）

> 本节总结当前对话中从零搭建生图功能的完整开发流程。

### 9.1 需求明确

**原始需求**：在 AI 对话页面支持"生图模式"，用户输入提示词后，系统调用 DashScope Wan2.7-image API 生成图片，并在对话界面显示。

**核心要求**：
1. 异步生成：生图耗时长（10-30秒），不能阻塞 UI
2. 持久化：刷新页面后图片依然显示
3. 多模型支持：未来可接入 OpenAI DALL-E 等其他模型

### 9.2 技术选型

| 层次 | 选型 | 理由 |
|------|------|------|
| 生图 API | DashScope Wan2.7-image | 阿里云通义万相，价格低，质量高 |
| 异步任务 | Background Worker（tsx） | 本地部署，无需 Redis/RabbitMQ |
| 文件存储 | AiFileAsset 表（base64） | 无需对象存储，适合小规模 |
| 前端轮询 | 不轮询，依赖 WebSocket（未来） | 当前版本：刷新页面查看结果 |

### 9.3 开发阶段

#### Phase 1：搭建 API + Worker（2小时）

**关键文件**：
- `app/api/ai/generate/image/route.ts`（POST API）
- `worker/background/handlers/image.handler.ts`（处理逻辑）
- `features/ai/llm/image-generator.ts`（统一生图接口）

**核心逻辑**：
1. 前端 POST `/api/ai/generate/image` 发起生图请求
2. API 创建 `AiChatMessage`（`executionStatus: "QUEUED"`）
3. API 创建 `AiGenerationJob`（`type: "IMAGE_GENERATE"`, `status: "pending"`）
4. Background worker 轮询 job 表，claim 后调用 `handleImageGenerate`
5. `handleImageGenerate` 调用 `image-generator.ts` → DashScope API
6. 图片生成后存入 `AiFileAsset`，创建 `AiMessageAttachment`
7. Message 状态更新为 `COMPLETED`

**踩坑**：
- Worker 启动时报 `typedData` 重复声明 → 删除冗余代码
- Job dispatcher 未注册 `IMAGE_GENERATE` → 添加 case

#### Phase 2：前端显示图片（30分钟）

**关键文件**：
- `features/ai/ui/AiMessageBubble.tsx`（渲染 attachments）
- `app/api/ai/file-assets/[id]/route.ts`（图片 GET API）

**核心逻辑**：
1. `AiMessageBubble` 检查 message 的 `attachments` 字段
2. 如果存在 `type: "IMAGE"`，调用 `GET /api/ai/file-assets/:id` 获取图片 base64
3. 渲染 `<img src={data:image/png;base64,...} />`

**踩坑**：
- 图片 base64 存储超出字段长度 → Prisma schema 改为 `@db.Text`

#### Phase 3：修复持久化 Bug（1小时）

**问题**：生图成功后刷新页面，图片消失。

**诊断**（按 diagnosing-bugs skill）：
1. Phase 1 — 建立反馈循环：复现 bug（生图 → 刷新 → 图片消失）
2. Phase 2 — 数据流追踪：发现 `GET /api/ai/conversations/:id` 返回的 message 缺少 `attachments` 字段
3. Phase 3 — 假设验证：单条消息 API 有 attachments，批量 API 没有 → 确认是 Prisma select 漏掉字段
4. Phase 4 — 修复：在 `conversation-store.ts` 和 `AiChatPanel.tsx` 补上 `attachments` 映射
5. Phase 5 — 验证：`npm run build` 通过，手动测试通过

**修复内容**：
- 后端：`conversation-store.ts` Prisma select 添加 `attachments` 嵌套查询
- 前端：`AiChatPanel.tsx` loadMessages 映射 `attachments` 到 Message 类型

### 9.4 完整技术栈

| 层次 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | Next.js | 15 | SSR + Client Component |
| 前端 UI | React | 19 | 组件化渲染 |
| 状态管理 | React Hooks | - | useState, useEffect |
| 后端 API | Next.js Route Handler | - | RESTful API |
| 数据库 ORM | Prisma | - | PostgreSQL schema `pm` |
| 异步任务 | Background Worker | - | tsx 轮询 job 表 |
| 生图 API | DashScope Wan2.7-image | - | 阿里云通义万相 |
| 文件存储 | AiFileAsset 表 | - | base64 + mimeType |

### 9.5 上线 Checklist

- [x] 后端 API 正常响应
- [x] Background Worker 正常消费 job
- [x] 图片生成成功后正确存入 DB
- [x] 前端正常显示图片
- [x] 刷新页面后图片持久化
- [ ] 生图失败时前端显示错误提示
- [ ] 支持多图生成（`n > 1`）
- [ ] 支持取消生图（前端 Cancel 按钮）
- [ ] 接入其他生图模型（OpenAI DALL-E, Stable Diffusion）
- [ ] 优化图片存储（迁移到 OSS / CDN）

---

## 10. 相关链接

- [生图 API 文档](../ARCHITECTURE.md#ai-image-generation)
- [Background Worker 运维](../OPERATIONS.md#background-worker)
- [Diagnosing Bugs Skill](/Users/vastgui/.cursor/skills/diagnosing-bugs/SKILL.md)
- [LLM Streaming Skill](/Users/vastgui/.cursor/skills/llm-streaming-response-handler/SKILL.md)

---

## 10. 附录：完整技术栈

| 层次 | 技术 | 用途 |
|------|------|------|
| 前端框架 | Next.js 15 + React 19 | SSR + Client Component |
| 状态管理 | React Hooks（useState, useEffect） | 本地状态 |
| UI 组件 | AiMessageBubble | 渲染消息和 attachments |
| 后端 API | Next.js Route Handler | RESTful API |
| 数据库 ORM | Prisma | PostgreSQL schema `pm` |
| 异步任务 | Background Worker（tsx） | 生图 job 处理 |
| 生图 API | DashScope Wan2.7-image | 阿里云通义万相 |
| 文件存储 | AiFileAsset 表 | 图片 base64 + mimeType |

---

**文档版本**：v1.0  
**最后更新**：2026-08-11  
**作者**：Cursor Agent（协助诊断与修复）
