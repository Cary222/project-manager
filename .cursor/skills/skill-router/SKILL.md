---
name: skill-router
description: Cursor 生态 Skill 路由与能力地图。ProjectHub 4 子代理（ai-learning-mentor / code-reviewer / fullstack-developer / skill-finder）的统一"该读哪个 skill"参考入口。当子代理被 Task 调用、需要在 35+ skill 中按需查功能时，必须先读这个 skill 定位。按需触发：用户问"有没有 X skill / 该用哪个 skill / 现有 skill 能做什么"时也读。
---

# Skill Router — Cursor 生态 Skill 路由表

> **📌 你的角色**：这是 **skill 的 skill** —— 唯一权威的"现有 skill 能力地图 + 路由"。
> 所有 ProjectHub 子代理（ai-learning-mentor / code-reviewer / fullstack-developer / skill-finder）在需要判断"该不该读哪个 skill"前，**先读本文档**。
>
> **📚 文档分层**：本文档是 L3 操作层扩展，**不进 L1/L2**，是 L3 内的"skill 路由"专用章节。

---

## 🎯 路由原则（核心 SOP）

```
子代理收到任务
    ↓
1. 识别任务领域（开发/AI/审查/导师/skill查找）
    ↓
2. Read 本文档 → 找到对应分类
    ↓
3. 根据"触发词"判断命中哪个 skill
    ↓
4. 按"必读/按需"决定要不要 Read 具体 SKILL.md
    ↓
5. ⛔ 不要一次读完所有 skill —— context 宝贵
```

**⛔ 严禁**：
- 通读 `~/.cursor/skills/` + `.cursor/skills/` + `.agents/skills/` 全目录
- 不读本文档就凭直觉挑 skill
- 任务简单（改一行/删 console.log）还硬读 skill

---

## 🗂️ 总览：35+ Skill 分 7 大类

| 分类 | Skill 数量 | 适用子代理 |
|------|----------|----------|
| **A. ProjectHub 专属** | 7 | fullstack-developer / code-reviewer / 所有 |
| **B. AI/LLM 框架** | 11 | fullstack-developer（开发 AI 时）/ ai-learning-mentor |
| **C. AI 多模态** | 6 | fullstack-developer（涉及图/视频/音频）|
| **D. 工程质量** | 3 | fullstack-developer / code-reviewer |
| **E. 工程基础设施** | 3 | 所有（context-engineering 通用）|
| **F. 学习导师** | 1 | ai-learning-mentor（专属）|
| **G. Skill 工具** | 1 | skill-finder（专属，但所有人都能查路由）|

---

## A. ProjectHub 专属开发（7 个）— **fullstack-developer 主战场**

> 这些是项目核心 skill，fullstack-developer 必须熟。

| Skill | 路径 | 触发词 | 必读/按需 | 适用任务 |
|-------|------|--------|----------|----------|
| **pm-dev** | `.cursor/skills/pm-dev/SKILL.md` | `改工单 / 改项目 / 改 auth / 改 API / 改 UI / 改 schema` | **必读**（每个任务都读）| 开发期主线 |
| **pm-ops** | `.cursor/skills/pm-ops/SKILL.md` | `重启 / 部署 / build / 查日志 / 改 env / 推 origin` | **按需** | 涉及运维/部署时 |
| **pm-testing** | `.cursor/skills/pm-testing/SKILL.md` | `测试 / test / 写测试 / vitest / playwright / e2e` | **按需** | 测试期 |
| **pretty-ui** | `.cursor/skills/pretty-ui/SKILL.md` | `美化 / 改好看 / 统一风格 / modern UI / 卡片 / 按钮 / 表单 / 弹窗 / 表格 / 写新页面 / 改旧页面` | **按需**（涉及 UI 时必读）| UI 改动 |
| **feature-first** | `.cursor/skills/feature-first/SKILL.md` | `FSD / feature-first / 重构 / 代码组织 / 架构升级` | **按需**（FSD 决策时读）| 架构层重构 |
| **dev-to-doc-recap** | `.cursor/skills/dev-to-doc-recap/SKILL.md` | `帮我把这个功能写成 md / 生成复现文档 / 写知识笔记 / 总结这次实现 / 让新手能复现` | **必读**（PR 完成后 → 8 段式复现文档）| 收尾留档 |
| **git-commit-assistant** | `~/.cursor/skills/git-commit-assistant/SKILL.md` | `提交 / commit / push / 帮我 push / git add / 帮我 commit` | **必读**（用户提到提交词时第一动作）| Git 提交 |

**🔗 跨引用**：
- pm-dev + pm-ops 的"事实"统一在 L2 `PROJECT-HUB.md`（唯一真相源）
- pretty-ui 用 `app/globals.css` 的 design token
- git-commit-assistant 配合项目钩子 `.cursor/rules/git-commit-required.mdc`

---

## B. AI / LLM 框架（11 个）— **fullstack-developer 开发 AI 时按需读**

> 这些 skill 都在 `~/.cursor/skills/` 或 `.agents/skills/`（用户级），**优先用项目 agents skills**（更新更勤）。

### B1. LangChain 生态（5 个）

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **langchain-architecture** | `.agents/skills/langchain-architecture/SKILL.md` | `LangChain / LangGraph / Agent / Tool Calling / Memory 系统` | **按需**（涉及 LangChain 时）|
| **langchain-rag** | `.agents/skills/langchain-rag/SKILL.md` | `RAG / 向量检索 / 文档加载 / embedding / vector store` | **按需**（涉及 RAG 时）|
| **langchain-middleware** | `.agents/skills/langchain-middleware/SKILL.md` | `human-in-the-loop / middleware / 人工审批 / 结构化输出` | **按需**（涉及 HITL 时）|
| **rag-retrieval** | `.agents/skills/rag-retrieval/SKILL.md` | `RAG 进阶 / reranking / 混合搜索 / HyDE / pgvector` | **按需**（RAG 调优时）|
| **conversation-memory** | `.agents/skills/conversation-memory/SKILL.md` | `持久化记忆 / 多会话 / 上下文 / entity memory` | **按需**（多会话持久化时）|

### B2. LangGraph 专题（4 个）

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **dive-into-langgraph** | `~/.cursor/skills/dive-into-langgraph/SKILL.md` | `LangGraph 1.0 / ReAct / state graph / Tool integration` | **按需**（深度学习 LangGraph 时）|
| **langgraph-fundamentals** | `.agents/skills/langgraph-fundamentals/SKILL.md` | `LangGraph StateGraph / 节点 / 边 / Command / Send` | **按需**（写 LangGraph 代码时）|
| **langgraph-human-in-the-loop** | `.agents/skills/langgraph-human-in-the-loop/SKILL.md` | `interrupt() / Command(resume) / 审批 / 验证` | **按需**（HITL 时）|
| **langgraph-persistence** | `.agents/skills/langgraph-persistence/SKILL.md` | `checkpointers / thread_id / time travel / Store` | **按需**（状态持久化时）|

### B3. LLM 响应处理（1 个）

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **llm-streaming-response-handler** | `~/.cursor/skills/llm-streaming-response-handler/SKILL.md` | `LLM streaming / SSE / token stream / chat UI / 打字机 / 实时 AI` | **按需**（涉及 SSE 流式 UI 时）|

**🔗 决策建议**：
- **LangChain 与 LangGraph 重叠时**：`langchain-architecture` 是入口；要深挖某专题再选 B2/B3 子 skill
- **RAG 入门**：`langchain-rag`；**RAG 调优**：`rag-retrieval`
- **LangGraph 入门**：`langgraph-fundamentals` 或 `dive-into-langgraph`；**HITL**：`langgraph-human-in-the-loop`；**持久化**：`langgraph-persistence`

---

## C. AI 多模态生成（6 个）— **fullstack-developer 处理图/视频/音频时**

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **ai-image-generation** | `.agents/skills/ai-image-generation/SKILL.md` | `生图 / image generation / FLUX / GPT Image / Seedream / RunComfy` | **按需** |
| **ai-video-generation** | `.agents/skills/ai-video-generation/SKILL.md` | `生视频 / video generation / HappyHorse / Wan / Seedance` | **按需** |
| **image-to-video** | `.agents/skills/image-to-video/SKILL.md` | `i2v / 静图动起来 / 图生视频` | **按需** |
| **openai-whisper** | `.agents/skills/openai-whisper/SKILL.md` | `语音转文字 / STT / whisper / 字幕` | **按需** |
| **qianwen-audio-tts** | `.agents/skills/qianwen-audio-tts/SKILL.md` | `语音合成 / TTS / qwen / 配音 / 朗读` | **按需** |
| **speech-engine** | `.agents/skills/speech-engine/SKILL.md` | `ElevenLabs / 实时语音 / WebSocket / WebRTC / 语音对话` | **按需** |

**🔗 决策建议**：
- **图片生成**：`ai-image-generation`（含 FLUX/GPT Image 等多模型路由）
- **视频生成**：`ai-video-generation`（text→video）；**静图转视频**：`image-to-video`
- **音频**：`openai-whisper`（语音→文字）/ `qianwen-audio-tts`（文字→语音）/ `speech-engine`（实时双向）

---

## D. 工程质量（3 个）— **fullstack-developer / code-reviewer**

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **tdd** | `.agents/skills/tdd/SKILL.md` | `TDD / 测试驱动 / red-green-refactor / 写测试优先` | **按需**（TDD 模式时）|
| **code-review** | `.agents/skills/code-review/SKILL.md` | `code review / 审查 / Standards / Spec` | **按需**（与 code-reviewer 子代理互补）|
| **diagnosing-bugs** | `~/.cursor/skills/diagnosing-bugs/SKILL.md` | `diagnose / debug / 排查 / 性能下降 / 异常` | **按需**（debug 时）|

**🔗 决策建议**：
- **TDD 写新功能**：`tdd`
- **正式 PR Review**：`code-review` skill（与 `code-reviewer` 子代理并行）
- **Bug 排查 / 性能退化**：`diagnosing-bugs`

---

## E. 工程基础设施（3 个）— **所有子代理通用**

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **context-engineering** | `.agents/skills/context-engineering/SKILL.md` | `context 优化 / agent 输出质量下降 / session 切换 / 配置 rules` | **按需**（context 工程）|
| **cursor-subagent-creator** | `~/.cursor/skills/cursor-subagent-creator/SKILL.md` | `创建子代理 / Cursor 子代理 / .cursor/agents/` | **按需**（建新 subagent 时）|
| **implement** | `.agents/skills/implement/SKILL.md` | `实现 / implement / 基于规格实现` | **按需**（spec-driven 实现）|

---

## F. 学习导师类（1 个）— **ai-learning-mentor 专属**

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **learning-progress-tracker** | `~/.cursor/skills/learning-progress-tracker/SKILL.md` | `学习进度 / 知识地图 / 已掌握 / 学习笔记` | **必读**（ai-learning-mentor 每次会话首读）|

---

## G. Skill 工具（1 个）— **skill-finder 专属**

| Skill | 路径 | 触发词 | 必读/按需 |
|-------|------|--------|----------|
| **skill-router** | **本文档** | `找 skill / 该用哪个 skill / 现有 skill 能做什么` | **按需**（按主题查路由）|

> **⛔ 注意**：本文档本身不进子代理的"必读列表"。子代理只在需要判断"该不该读哪个 skill"时按需读它。

---

## 🚦 4 子代理的 Skill 调用路由速查表

### ai-learning-mentor（学习导师 + 架构顾问）

| 必读 | 按需 |
|------|------|
| `learning-progress-tracker`（每次会话首读）| `langchain-*` / `dive-into-langgraph`（教 AI 概念时）|
| `pm-dev/PROJECT-HUB.md` § 🏁+§ 🧬+§ 🤖（L2 事实层）| `rag-retrieval` / `conversation-memory`（教 RAG 进阶时）|
| | `skill-router`（判断"该读哪个 skill"时）|

### code-reviewer（硬层审查）

| 必读 | 按需 |
|------|------|
| `pm-dev/SKILL.md`（L3 操作层约定）| `code-review` skill（互补）|
| `pm-dev/PROJECT-HUB.md` § 🏁+§ 🧬 | `tdd`（审查测试覆盖时）|
| 主代理 prompt 指示的 L4 PR 复现 | `diagnosing-bugs`（审查 bug 修复时）|

### fullstack-developer（执行者）— **skill 使用最多**

| 必读 | 按需 |
|------|------|
| `pm-dev/SKILL.md`（每次任务都读）| `pm-ops/SKILL.md`（deploy/restart 时）|
| `pm-dev/PROJECT-HUB.md` § 🏁+§ 🧬 | `pretty-ui`（UI 改动时）|
| `git-commit-assistant`（用户提"提交"时）| `feature-first`（FSD 决策时）|
| `dev-to-doc-recap`（**PR 完成后必读 → 产 8 段式复现文档**）| `dev-to-doc-recap`（功能完成时）|
| | `langchain-*` / `dive-into-langgraph`（开发 AI 功能时）|
| | `llm-streaming-response-handler`（SSE 流式 UI 时）|
| | `rag-retrieval`（RAG 调优时）|
| | `ai-image-generation` / `ai-video-generation` 等（多模态时）|
| | `tdd` / `diagnosing-bugs`（TDD / debug 时）|
| | `skill-router`（不确定该读哪个时）|

### skill-finder（找/装 skill）

| 必读 | 按需 |
|------|------|
| `skill-router`（先查现有 skill 避免重复推荐）| `cursor-subagent-creator`（用户要建新 subagent 时）|
| `~/.cursor/skills/` 目录扫描 | |

---

## 🔍 快速决策树（按"用户原话"路由）

```
用户说："提交" / "commit" / "push"
  └→ 必读 git-commit-assistant

用户说："重启服务" / "部署" / "build" / "查日志"
  └→ 必读 pm-ops/SKILL.md

用户说："改工单" / "改项目" / "改 API" / "改 UI" / "改 schema"
  └→ 必读 pm-dev/SKILL.md + L2 § 🏁+§ 🧬

用户说："写测试" / "test" / "TDD"
  └→ 必读 pm-testing/SKILL.md + tdd

用户说："美化" / "改好看" / "现代风"
  └→ 必读 pretty-ui

用户说："RAG" / "embedding" / "向量检索"
  └→ 必读 langchain-rag（入门）
  └→ 按需 rag-retrieval（调优）

用户说："Agent" / "Tool Calling" / "LangGraph"
  └→ 必读 langchain-architecture（入口）
  └→ 按需 langgraph-fundamentals（写代码）
  └→ 按需 langgraph-human-in-the-loop（HITL）
  └→ 按需 langgraph-persistence（持久化）

用户说："SSE" / "流式" / "打字机" / "token stream"
  └→ 必读 llm-streaming-response-handler

用户说："生图" / "image"
  └→ 必读 ai-image-generation

用户说："生视频" / "video"
  └→ 必读 ai-video-generation

用户说："语音转文字" / "STT"
  └→ 必读 openai-whisper

用户说："TTS" / "文字转语音" / "朗读"
  └→ 必读 qianwen-audio-tts

用户说："实时语音对话" / "WebRTC 语音"
  └→ 必读 speech-engine

用户说："bug" / "调试" / "性能退化" / "卡顿"
  └→ 必读 diagnosing-bugs

用户说："重构" / "代码组织" / "FSD"
  └→ 必读 feature-first

用户说："review" / "审查 PR"
  └→ 主代理派 code-reviewer 子代理（不是 skill）

用户说："找 skill" / "装 skill"
  └→ 必读 skill-router（本文档）+ 派 skill-finder 子代理

用户说："学习" / "教我"
  └→ 派 ai-learning-mentor 子代理
```

---

## 📦 Skill 物理位置分布

| 路径前缀 | 数量 | 特征 |
|---------|------|------|
| `.cursor/skills/` | 6 | 项目级，跟随仓库；只放项目相关（pm-dev/pm-ops/pm-testing/pretty-ui/feature-first/dev-to-doc-recap）|
| `.agents/skills/` | 22 | 项目内 agents skills（langchain-*、多模态、tdd、code-review 等）|
| `~/.cursor/skills/` | 14 | 用户级，全局共享；不进入项目仓库（git-commit-assistant、learning-progress-tracker 等）|

**⛔ 路径优先级**：
1. **项目级 `.cursor/skills/`** 优先（项目定制）
2. **项目内 `.agents/skills/`** 次之（更新勤）
3. **用户级 `~/.cursor/skills/`** 兜底（通用）

> ProjectHub 文档（pm-dev/pm-ops/pm-testing/pretty-ui）只在 `.cursor/skills/` 下，**不要去 `~/.cursor/skills/` 找**（那里没有）。

---

## 🔗 必读链接

- L1 入口：[AGENTS.md](../../../AGENTS.md)
- L2 事实层：[PROJECT-HUB.md](../pm-dev/PROJECT-HUB.md)
- L3 操作层：[pm-dev/SKILL.md](../pm-dev/SKILL.md)
- 4 子代理调用策略：[.cursor/agents/](../../agents/)
