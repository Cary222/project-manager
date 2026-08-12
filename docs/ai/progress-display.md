# AI 生图/视频进度显示功能

> 适用：project-manager 仓库（Next.js + Prisma + PostgreSQL）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"AI 生图/视频进度显示"功能的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么
- **现象**：用户发起生图/视频请求后，界面只显示"正在生成图片..."或"正在生成视频..."，没有任何进度反馈
- **用户困惑**：不知道任务是卡住了还是在处理，也不知道要等多久
- **业务影响**：用户可能重复提交请求，或认为功能坏了

### 1.2 结论
- 新版在 loading 占位框内显示**真实进度条 + 百分比**，文字动态更新为后端返回的进度详情
- 视频生成：显示 Agnes API 返回的 `progress`（0-100%）
- 图片生成：显示阶段性进度（调用模型 → 处理图片）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | `metadata` 字段注释说明支持 `progress` |
| `app/api/ai/messages/[id]/route.ts` | 修改 | GET 接口返回 `metadata`（含 progress） |
| `features/ai/llm/image-generator.ts` | 修改 | 生图函数增加 `onProgress` 回调 |
| `features/ai/llm/video-generator.ts` | 修改 | 视频轮询时触发进度回调 |
| `worker/background/handlers/image.handler.ts` | 修改 | 调用生图时传入进度回调，更新 DB 和 SSE |
| `worker/background/handlers/video.handler.ts` | 新增 | 视频生成 handler，支持进度更新 |
| `features/ai/ui/AiLoadingIndicator.tsx` | 新增 | 统一的 loading 指示器组件，支持进度条 |
| `features/ai/ui/AiMessageBubble.tsx` | 修改 | 接收 `progress` prop，传递给 AiLoadingIndicator |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | 轮询时读取 progress 并更新消息内容 |

---

## 3. 核心实现

### 3.1 后端进度数据流（Worker → DB → 前端轮询）

**关键流程**：
1. Worker 调用视频/图片生成 API
2. 生成过程中触发 `onProgress` 回调
3. 回调内更新 `AiChatMessage.metadata`（含 `progress` 字段）
4. 前端每 2 秒轮询 `/api/ai/messages/[id]`
5. 读取 `metadata.progress` 更新 UI

```97:148:features/ai/llm/video-generator.ts
async function pollVideoTask(
  taskId: string,
  videoId: string,
  apiKey: string,
  baseURL: string,
  timeoutMs: number = 300000, // 5 分钟超时
  onProgress?: (percent: number, detail: string) => void
): Promise<{ url: string; size: string; seconds: string }> {
  // ...轮询逻辑...
  while (Date.now() - startTime < timeoutMs) {
    // 每次轮询触发进度回调
    if (onProgress) {
      onProgress(data.progress ?? 0, `视频生成中 (${data.progress ?? 0}%)`);
    }
    // ...
  }
}
```

**为什么这样写**：视频生成是异步任务（Agnes API），只能通过轮询获取进度。每次轮询结果通过回调传给 handler，handler 再更新数据库和 SSE。

### 3.2 前端轮询 + 进度更新

```652:719:features/ai/ui/AiChatPanel.tsx
const startPolling = useCallback(
  (messageId: string, startTime: number, timeoutMs = 3 * 60 * 1000) => {
    pollingRef.current = setInterval(async () => {
      const res = await fetch(`/api/ai/messages/${messageId}`);
      const data = await res.json();
      const progress = data.metadata?.progress;

      if (data.executionStatus === "COMPLETED" || data.executionStatus === "FAILED") {
        // 完成后停止轮询
        clearInterval(pollingRef.current);
        // 更新消息内容
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, content: progress?.detail ?? m.content, executionStatus: data.executionStatus }
            : m
        ));
      } else {
        // 实时更新进度
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, content: progress?.detail ?? m.content, progress: progress ?? m.progress }
            : m
        ));
      }
    }, 2000);
  }, []
);
```

**为什么这样写**：轮询间隔 2 秒，平衡实时性和服务器压力。`content` 动态更新为进度详情（如"视频生成中 (30%)"）。

### 3.3 进度条组件

```97:120:features/ai/ui/AiLoadingIndicator.tsx
{/* 进度条 */}
<div className="h-1 w-3/4 overflow-hidden rounded-full bg-ink-200/50">
  {progress !== undefined ? (
    // 真实进度条
    <div
      className="h-full rounded-full bg-brand-500 transition-all duration-500"
      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
    />
  ) : (
    // 动画进度条
    <div className="h-full animate-progress-bar rounded-full bg-brand-400/60" />
  )}
</div>

{/* 百分比显示 */}
{progress !== undefined && (
  <span className="text-xs font-medium text-ink-500">{progress}%</span>
)}
```

**为什么这样写**：传入 `progress` 时显示真实进度条和百分比；未传入时显示动画进度条（保持视觉活跃感）。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `DATABASE_URL` | PostgreSQL 连接串 | pm schema |
| Prisma Client | v6.19.3 | 需在服务器上 `npx prisma generate` |
| `thinking-orbs` | ^0.3.1 | 思考动画组件 |
| 视频模型 | `agnes:agnes-video-v2.0` | Agnes API |
| 图片模型 | `wan2.7-image` / `agnes-image-2.1-flash` | 支持多种 provider |

---

## 5. 启动 / 部署

```bash
# 1. 本地开发
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 2. 服务器部署（需要先 push 代码）
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager

# 3. 拉取最新代码
git pull origin main

# 4. 推送 schema 变更（如果有）
npx prisma db push --accept-data-loss --skip-generate

# 5. 重新生成 Prisma Client
npx prisma generate

# 6. 重启 Next.js 服务
pkill -f "next start" ; sleep 2 ; npm run start > /tmp/pm.log 2>&1 &

# 7. 重启后台 Worker
pkill -f "tsx worker/background" ; sleep 2 ; npm run worker:background > /tmp/bg-worker.log 2>&1 &

# 8. 确认服务运行
ps aux | grep -E "next|tsx" | grep -v grep
tail -5 /tmp/bg-worker.log
```

---

## 6. 测试 & 验证

### 6.1 后台 Worker 日志验证

```bash
# 服务器上查看 Worker 日志
ssh hxy@192.168.1.14 "tail -20 /tmp/bg-worker.log"
```

**期望输出**：
```
[bg-worker] claimed job=xxx type=VIDEO_GENERATE attempt=1
[video-handler] userId=xxx modelRef=agnes:agnes-video-v2.0
[agnes-video] 任务创建成功: video_id=task_xxx status=queued
[agnes-video] 轮询 video_id=task_xxx: status=in_progress progress=30%
[agnes-video] 轮询 video_id=task_xxx: status=in_progress progress=50%
[agnes-video] 轮询 video_id=task_xxx: status=in_progress progress=80%
```

### 6.2 API 轮询验证

```bash
# 手动轮询消息接口
curl "http://localhost:3003/api/ai/messages/{messageId}" \
  -H "Cookie: next-auth.session-token=xxx"
```

**期望输出**：
```json
{
  "id": "{messageId}",
  "executionStatus": "PROCESSING",
  "metadata": {
    "progress": {
      "step": "generating",
      "percent": 30,
      "detail": "视频生成中 (30%)"
    }
  }
}
```

### 6.3 端到端验证

1. 打开浏览器访问 `http://192.168.1.14:3003`
2. 切换到**视频模式**
3. 输入"帮我生成美剧 shamless 视频"
4. 观察：
   - ✅ 消息气泡显示"正在生成视频..."
   - ✅ 下方出现带播放图标的占位框
   - ✅ 占位框内进度条从 0% 逐步增长
   - ✅ 文字更新为"视频生成中 (30%)"等

---

## 7. 复现 Checklist

- [ ] 服务器 `npx prisma generate` 已执行
- [ ] 服务器 Prisma schema 已 push（`npx prisma db push`）
- [ ] 后台 Worker 已重启（`npm run worker:background`）
- [ ] Next.js 服务已重启
- [ ] 浏览器清除缓存（或硬刷新）
- [ ] 发起视频生成请求
- [ ] 观察 Worker 日志有进度输出
- [ ] 观察前端显示进度条和百分比
- [ ] 等待任务完成，确认视频正常显示

---

## 8. 踩坑记录

### 坑 1：Prisma enum `VIDEO_GENERATE` 未定义

**现象**：
```
Error: Value 'VIDEO_GENERATE' not found in enum 'BackgroundJobType'
```

**原因**：本地代码已有 `VIDEO_GENERATE` enum，但服务器上的 Prisma Client 没有重新生成。

**解法**：
```bash
# 服务器上执行
npx prisma generate
```

### 坑 2：db push 报数据丢失（VIDEO_GENERATE 枚举值）

**现象**：
```
Error: Use the --accept-data-loss flag to ignore the data loss warnings
```

**原因**：数据库中已有 `VIDEO_GENERATE` 类型的任务记录。

**解法**：
```bash
# 先删除失败的 VIDEO_GENERATE 任务
PGPASSWORD=community psql 'postgresql://community:community@localhost:5432/community?options=-c%20search_path%3Dpm,public' \
  -c "DELETE FROM \"BackgroundJob\" WHERE type = 'VIDEO_GENERATE' AND status = 'FAILED';"

# 再 push schema
npx prisma db push --accept-data-loss --skip-generate
```

### 坑 3：本地 staging 但未 commit 导致服务器代码不同步

**现象**：本地改了 schema 但只 staging 没 commit，push 到服务器后代码没有变化。

**原因**：Git 操作不完整，文件在工作区但不在 commit 历史中。

**解法**：
1. 确保所有改动都 `git add` + `git commit`
2. push 前检查 `git log --oneline -3` 确认 commit 存在

### 坑 4：`thinking-orbs` 组件 size 属性类型错误

**现象**：
```
Type error: Type '32' is not assignable to type 'OrbSize | undefined'.
```

**原因**：`OrbSize` 只接受 `20 | 64`，不接受 `32`。

**解法**：
```tsx
// 改为
<ThinkingOrb state="working" size={64} />
```

### 坑 5：Agent 未经用户允许新建分支

**现象**：用户反馈"你为什么新建分支没有我的允许"。

**原因**：Agent 默认行为错误，应该只在 main 分支操作，除非用户明确要求。

**解法**：
- 所有改动直接在 main 分支
- 如需分支，必须先获得用户明确授权
- 遵循 `git-commit-required.mdc` 规则

---

## 附录：相关文件路径

| 文件 | 说明 |
|------|------|
| `worker/background/handlers/video.handler.ts` | 视频生成 Worker Handler |
| `worker/background/handlers/image.handler.ts` | 图片生成 Worker Handler |
| `features/ai/llm/video-generator.ts` | 视频生成逻辑（轮询 + 进度回调） |
| `features/ai/llm/image-generator.ts` | 图片生成逻辑 |
| `features/ai/lib/domain-events.ts` | SSE 事件发射（emitMessageDelta） |
| `features/ai/ui/AiChatPanel.tsx` | 聊天面板 + 轮询逻辑 |
| `features/ai/ui/AiMessageBubble.tsx` | 消息气泡（接收 progress） |
| `features/ai/ui/AiLoadingIndicator.tsx` | Loading 指示器（进度条组件） |
