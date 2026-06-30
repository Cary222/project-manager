# 子代理协作 SOP 演进归档

## 上下文

`/Users/vastgui/Desktop/project-manager/.cursor/rules/subagent-coordination-sop.mdc` 已经多次演进。本文件用于记录历次演进的**思路变化**，便于后续追溯。

## 版本演进

### v1（已被覆盖）— 主代理轮询 + 模式 A/B/C/D

**关键设计：**

- 模式 A：主代理 `sleep + 查 transcript 文件大小 + 关键字` 轮询
- 模式 D：并行启动 `code-reviewer` + `ai-learning-mentor`，主代理轮询等两份报告
- 强约束："不能用 background 模式"（双线都设 `run_in_background: false`）

**问题：**

- 依赖 transcript 文件大小变化作为完成信号 → Cursor 不保证这一点
- "判断完成的信号：transcript 最后一行 assistant 文本包含 '## X 完工报告' 关键字" → 把聊天记录当状态源
- 轮询间隔、次数写死 → 平台一改行为就崩
- 子代理对"完成信号"理解不一致 → 长期维护成本高

### v2（当前，已落地）— 9 条规则 + Final Response 模板

**关键设计：**

- 核心原则改为："不要设计 Cursor 没有提供的能力"
- Rule 0：什么时候拆 Agent（正反例）
- Rule 5：Foreground 优先
- Rule 6：Background 用 Resume 而不是轮询（次数不写死）
- Rule 7：Final Response 模板（含 Open Questions）
- Rule 8：Hook 仅用于自动化（可选）

**改进点：**

- Cursor 唯一可靠的完成信号 = Task Final Response（不再依赖 transcript）
- 删除所有 status.json / heartbeat / events.log / task.lock / snapshot 设计
- 删除模式 A/B/C/D 复杂分类（已无意义）
- 子代理不写状态文件、不轮询、不查询其他 agent
- 把 Rule 6 的"Resume → Resume → 重派"改为"优先 Resume，无法恢复再重派"——不写死次数

### 评分对照

| 版本 | Cursor 适配度 | 复杂度 |
|-----|-------------|--------|
| v1（transcript 轮询） | 7.5/10 | 中 |
| TCP 草案（曾提出） | 7/10 | 高 |
| **v2（当前）** | **9.5/10** | **极简** |

## 真实收益点

不要再花时间设计 TCP / 状态机 / 事件日志。真正应投入的 4 件事：

1. **每个 Agent 的职责边界**（避免重复工作）
2. **Prompt 标准化**（输入统一）
3. **Final Response 标准化**（输出统一）
4. **Main Agent 编排逻辑**（什么时候拆 / 并行 / 串行）

这 4 件事对开发效率提升远大于自建运行时协议。

### v3（已落地）— 6 阶段主流程 + Mode C 降级 + Authority + Immutable

**触发背景**：Round 2 子代理协作时踩了 Background Final Response 回流坑，且 Round 1 的模式 D（双线并行审查）流程太重，小任务没必要走完整链路。

**关键设计**：

- 核心理念压缩到一句：**Main 拆分任务、控制边界、协调流程、做最终决策；Subagent 仅在明确的 Scope 内执行和建议，不负责调度、协调或流程控制。**
- Mode C 作为默认降级路径：任务 ≤3 文件 或 不可拆分时，走 `Main → fullstack-developer → tsc → Final Response`，不进入 6 阶段
- 主流程 6 阶段（仅 Mode C 不适用时启用）：Task Analysis → Advisor Review → Feature Fan-out → Merge + Smoke Review → Document → User Decide
- Advisor 输出固定三档（`APPROVED / CHANGES_REQUIRED / BLOCKED`），方便 Main 直接 if 判断
- Stage2 Review 改为可选（Main 判断：业务/DB/架构/权限/API 才 Review；改 README/注释/样式跳过）
- Stage3 Merge 拆分为"Main 决策" + "fullstack-developer 执行 Git"（**必须遵循 `git-commit-required.mdc` 纪律**）
- Smoke Review 只查整体一致性，不重做完整 review
- 新增 Rule X "Authority Boundary"：Main 决策，Subagent 建议
- 新增 Rule Y "Immutable Input"：派发后的 Feature Scope 不可修改
- Rule 7 降级 Background：默认 Foreground，无依赖任务才用 Background（保留未来兼容性）
- Rule 9 transcript：改为"仅作异常恢复手段"（正常流程不读 transcript）

**改进点**：

- 彻底解决了 Background Final Response 拿不到的坑
- Mode C 让小任务 Token 最少，大任务有完整链路，SOP 能自动降级
- 不再假设 Cursor Runtime"一定并发"，调度策略由 Runtime 决定，SOP 不依赖
- 不再让 Main 操作 Git，所有 Git 命令由 fullstack-developer 执行
- Review 改为可选，减少不必要的审查开销
- Immutable Input 防止派发后 Scope 漂移导致不同 Agent 拿到不同 Prompt

### 评分对照

| 版本 | Cursor 适配度 | 复杂度 | Token 效率 |
|-----|-------------|--------|-----------|
| v1（transcript 轮询） | 7.5/10 | 中 | 低 |
| v2（极简 9 规则） | 9.5/10 | 极简 | 中 |
| **v3（当前）** | **10/10** | **简洁** | **高（Mode C 降级）** |

## 参考资料

- Cursor 2.4 / 3.0.x 文档（独立 Context / Background Agent / Hook 完善）
- `.cursor/rules/subagent-coordination-sop.mdc`（v3 当前版）
- `.cursor/agents/` 三个 agent 文件（fullstack-developer / code-reviewer / ai-learning-mentor）
- `.cursor/skills/dev-to-doc-recap/SKILL.md`（Stage4 复现文档 8 段式）
