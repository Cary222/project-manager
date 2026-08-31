# Pi 插件（扩展包）汇总

> 生成时间：2026-08-26 ｜ 数据来源：`~/.pi/agent/settings.json`（packages 数组）+ `~/.pi/agent/npm/package.json`
> 状态判定：出现在 settings.json `packages` 数组中的插件 = 已启用；已安装（node_modules 存在）但不在数组内 = 停用。

**共安装 22 个插件，全部启用，无停用。**

| # | 启用状态 | 包名 | 版本 | 功能简介 |
|---|---------|------|------|---------|
| 1 | ✅ 启用 | pi-web-access | 0.24.0 | 联网能力全家桶：网页搜索（支持 OpenAI/Brave/Tavily/Gemini 等 17 家搜索源）、URL 抓取、GitHub 仓库克隆、PDF 提取、YouTube 视频理解、本地视频分析。提供 web_search / source_check / fetch_content 等工具 |
| 2 | ✅ 启用 | pi-subagents | 0.56.0 | 子代理系统：单代理委托 + 脚本化多代理工作流（并行、链式、异步、分叉上下文），支持顾问评审、实现交接、多步骤任务编排 |
| 3 | ✅ 启用 | @juicesharp/rpiv-ask-user-question | 2.7.0 | 结构化问卷工具：模型拿不准需求时，用带选项的提问代替自由文本猜测（ask_user_question） |
| 4 | ✅ 启用 | pi-hermes-memory | 0.9.6 | 持久记忆系统：token 感知的记忆策略、SQLite FTS5 会话搜索、记忆自动整合、过程技能（skills）、密钥扫描。提供 memory_* / session_search / skill_manage 工具 |
| 5 | ✅ 启用 | pi-mcp-adapter | 2.27.0 | MCP（Model Context Protocol）适配器：接入外部 MCP 服务器，提供 mcp / mcpScript 网关与脚本编排 |
| 6 | ✅ 启用 | @plannotator/pi-extension | 0.27.7 | Plannotator 计划评审：交互式计划审阅、给 agent 消息/代码/PR 加批注，导出/分享引导式评审 |
| 7 | ✅ 启用 | @vigolium/piolium | 0.0.13 | 多阶段安全审计套件：专业子代理、隔离上下文窗口、限流并发、可恢复状态。包含 audit / semgrep / codeql / differential-review 等 20+ 安全技能 |
| 8 | ✅ 启用 | @companion-ai/feynman | 0.3.38 | 科研优先的 CLI agent（基于 Pi + alphaXiv）：深度研究、文献综述、论文写作/评审、蛋白质结构预测、80+ 科学数据库检索（feynman_science_database_search 等） |
| 9 | ✅ 启用 | context-mode | 1.0.169 | 上下文节省插件：沙箱代码执行（ctx_execute）、FTS5 知识库（ctx_index/search）、意图驱动检索，号称节省 98% 上下文窗口 |
| 10 | ✅ 启用 | pi-background-tasks | 2.4.2 | 后台任务系统：持久后台 shell 任务（bg_run）、只读委托 agent（bg_delegate）、本地受信 Pi 运行（bg_run_pi_attested）、Fusion 固定目的工作流 |
| 11 | ✅ 启用 | @juicesharp/rpiv-todo | 2.7.0 | 任务清单：实时悬浮层渲染，/reload 与会话压缩后仍保留（todo 工具） |
| 12 | ✅ 启用 | pi-lens | 4.1.1 | 实时代码反馈：LSP 诊断、linter、格式化、类型检查、AST 结构分析、ast-grep 搜索/替换、依赖图/循环检测 |
| 13 | ✅ 启用 | @dietrichgebert/ponytail | 4.9.0 | 「懒惰资深开发」模式：强制最短可行方案、YAGNI、标准库优先、反对过度设计。当前会话已激活（full 级） |
| 14 | ✅ 启用 | @ff-labs/pi-fff | 0.10.5 | FFF 驱动的模糊搜索：基于 frecency 的文件/内容模糊查找（fffind / ffgrep），git 感知、智能大小写 |
| 15 | ✅ 启用 | pi-goal-list-loop-audit | 0.35.64 | 自主运行控制台：访谈式目标起草、可审计任务队列、长时运行循环（metric/spec/project-audit），分离审计进程独立复核完成结果 |
| 16 | ✅ 启用 | @quintinshaw/pi-dynamic-workflows | 3.7.0 | 动态工作流：任务扇出到上百子代理、真实模型路由、token/成本核算、恢复、git worktree 隔离、/workflows TUI 与 /deep-research |
| 17 | ✅ 启用 | @gotgenes/pi-permission-system | 27.0.1 | 权限执行系统：对 Pi 编码 agent 做权限强制（本地扩展目录亦有对应副本，含评审日志） |
| 18 | ✅ 启用 | pi-intercom | 0.12.0 | 会话间通信：本机多个 pi 会话互发消息、委派任务、跨会话共享上下文 |
| 19 | ✅ 启用 | @braintrust/pi-extension | 1.0.0 | Braintrust 集成：自动追踪 pi 会话、轮次、LLM 调用与工具执行到 Braintrust（配置见 braintrust.json） |
| 20 | ✅ 启用 | @narumitw/pi-plan-mode | 0.53.0 | 计划模式：类 Codex 的只读 /plan 协作模式，先规划再执行 |
| 21 | ✅ 启用 | pi-wechat-assistant | 0.3.0 | 微信分身：把微信当作 pi TUI 的移动端遥控器，通过微信远程交互、收发文件/图片 |
| 22 | ✅ 启用 | pi-agent-browser-native | 0.5.0 | 浏览器自动化：将 agent-browser 暴露为原生工具（agent_browser），可浏览网页、点击填写、截图、跑 QA 检查 |

---

## 备注

- **本地扩展目录** `~/.pi/agent/extensions/`：仅 pi-permission-system（权限系统）一份本地副本（含 permission-review 日志），与 npm 安装的 @gotgenes/pi-permission-system 对应。
- **微信助手** `~/.pi/agent/wechat-assistant/`：含 credentials.json（微信凭证）与 context-tokens.json。
- **默认模型**：deepseek-v4-flash（settings.json），思考级别 high。
- 停用方法：从 settings.json 的 `packages` 数组移除该项即可（无需卸载 npm 包）；全部启用时无停用项。
