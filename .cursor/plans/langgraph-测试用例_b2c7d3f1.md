# LangGraph 模式测试用例

**环境配置**: `USE_LANGGRAPH=true`

---

## 测试执行

1. 打开浏览器访问 `http://localhost:3003`
2. 进入 AI 对话界面
3. 打开终端查看日志输出
4. 按顺序执行以下测试用例

---

## B1: 节点路由测试

### B1.1 工单查询
- **输入**: `#10156`
- **预期节点**: detectIntent → searchStructured → generateResponse → END
- **验证**: 返回工单详情

### B1.2 人员近况
- **输入**: `lhy 最近在干什么`
- **预期节点**: detectIntent → searchStructured → generateResponse → END
- **验证**: 返回 lhy 的近况

### B1.3 项目列表
- **输入**: `查看项目`
- **预期节点**: detectIntent → searchStructured → generateResponse → END
- **验证**: 返回项目列表

### B1.4 周报列表
- **输入**: `本周周报有哪些`
- **预期节点**: detectIntent → searchStructured → generateResponse → END
- **验证**: 返回周报列表

### B1.5 Chat 对话
- **输入**: `你好`
- **预期节点**: detectIntent → generateResponse → END
- **验证**: 直接回复

### B1.6 深度检索
- **输入**: `光污染传感器需求`
- **预期节点**: detectIntent → searchKnowledge → searchStructured → generateResponse → END
- **验证**: 先 RAG 检索，再结构化查询

### B1.7 联网搜索
- **输入**: `今天天气`
- **预期节点**: detectIntent → webSearch → generateResponse → END
- **验证**: 返回天气信息

---

## B2: HIL 单轮消歧

### B2.1 用户名多匹配
- **输入**: `刘工`
- **预期**: 显示候选人列表
- **日志检查**: `[disambiguateIntentNode] decision.human entityType=user candidates=N`
- **SSE 事件**: `{ type: "pending_confirmation", entityType: "user", candidates: [...] }`

### B2.2 选择用户
- **输入**: 选择候选人中的 `1`
- **预期**: 返回刘屹鹏近况
- **日志检查**: `pendingHumanAction = null`, `resolvedEntities = { user: { id, name } }`

### B2.3 取消选择
- **输入**: `0` 或 `取消`
- **预期**: 取消确认，流程结束
- **日志检查**: `pendingHumanAction = null`, `resolvedEntities = null`

### B2.4 无效输入重试
- **输入**: `abc`
- **预期**: 显示错误提示，重新选择
- **日志检查**: 错误消息追加到 messages

---

## B3: HIL 多轮消歧

### B3.1 用户 → 周报
- **步骤 1**: 输入 `刘工的周报`
- **步骤 2**: 选择候选人 `1`
- **预期**: 返回刘屹鹏的周报列表

### B3.2 用户 → 工单
- **步骤 1**: 输入 `刘工的工单`
- **步骤 2**: 选择候选人 `1`
- **预期**: 返回刘屹鹏的工单列表

---

## B4: 状态持久化

### B4.1 中断恢复
- **步骤 1**: 输入 `刘工`，触发消歧
- **步骤 2**: 刷新页面
- **步骤 3**: 选择候选人 `1`
- **预期**: 从 pendingState 恢复，继续流程

### B4.2 多次轮次
- **步骤 1**: 输入 `刘工最近在干什么`
- **步骤 2**: 选择候选人
- **步骤 3**: 输入 `他上周做了什么`
- **预期**: 状态正确累积

---

## 日志检查点

```
[AI-LangGraph] start conv=xxx message="xxx" mode=xxx
[AI-LangGraph] pendingState loaded: null
[AI-LangGraph] detectIntent: mode=xxx
[AI-LangGraph] searchStructured: type=xxx id=xxx
[AI-LangGraph] searchStructured result length=xxx
[disambiguateIntentNode] decision.human entityType=xxx candidates=N
[AI-LangGraph] pending_human_action: N candidates
[AI-LangGraph] done. toolResults=N, textLen=N
```

---

## 测试结果记录

| 用例 | 状态 | 备注 |
|------|------|------|
| B1.1 工单查询 | ☐ | |
| B1.2 人员近况 | ☐ | |
| B1.3 项目列表 | ☐ | |
| B1.4 周报列表 | ☐ | |
| B1.5 Chat 对话 | ☐ | |
| B1.6 深度检索 | ☐ | |
| B1.7 联网搜索 | ☐ | |
| B2.1 用户名多匹配 | ☐ | |
| B2.2 选择用户 | ☐ | |
| B2.3 取消选择 | ☐ | |
| B2.4 无效输入重试 | ☐ | |
| B3.1 用户→周报 | ☐ | |
| B3.2 用户→工单 | ☐ | |
| B4.1 中断恢复 | ☐ | |
| B4.2 多次轮次 | ☐ | |
