# AI Workspace 登录后跳转首页 Bug 修复

## 问题现象

用户登录后点击 `/ai-workspace` tab，页面会直接跳转到 `http://localhost:3003/`（首页），无法进入 AI Workspace 页面。

## 排查过程

### 1. 排除服务端认证问题

用提供的账号登录后，直接用 cookies 测试 API 和页面：

- `/api/sessions` → 200 OK，返回完整 session 列表（认证正常）
- `/ai-workspace` → 200 OK，页面正常渲染

结论：**服务端认证和路由都没问题**，问题在客户端运行时。

### 2. 定位客户端跳转逻辑

用户描述"跳转到首页 `/`"（不是 `/login`），说明是客户端有代码执行了 `router.replace("/")`。

在 `features/ai/ui/ai-workspace/AppShell.tsx` 中找到 3 处：

| 行号 | 触发场景 |
|------|----------|
| 569 | 切换工作目录（`handleCwdChange`） |
| 621 | 创建新 session（`handleNewSession`） |
| 808 | 删除 session 后 |

这些代码都调用 `router.replace("/", { scroll: false })`。

## 根因

这段代码是从 **pi web 完整移植** 过来的。原始 pi 应用运行在**根路径** `/`，所以 `router.replace("/")` 的意图是"清除 URL 上的 `?session=xxx` 查询参数，回到工作区首页"。

但移植到本项目后，AI Workspace 挂载在 `/ai-workspace` 子路径下。`router.replace("/")` 会把用户导航到项目首页（Dashboard），而不是清除当前页面的查询参数——这正是"跳转首页"的原因。

## 修复

把 3 处硬编码的 `"/"` 改为 `window.location.pathname`，这样清除查询参数时会保持在当前页面路径（`/ai-workspace`）：

```typescript
// 修复前
router.replace("/", { scroll: false });

// 修复后
router.replace(window.location.pathname, { scroll: false });
```

其余 4 处带 `?session=${id}` 参数的 `router.replace` 是相对路径导航，不受影响。

## 验证

登录后访问 `/ai-workspace` 返回 200 且正确渲染 "Loading AI Workspace..." 加载态，页面标题为 "AI Workspace - ProjectHub"，不再跳转首页。

## 关联文件

- `features/ai/ui/ai-workspace/AppShell.tsx`（3 处修改）
