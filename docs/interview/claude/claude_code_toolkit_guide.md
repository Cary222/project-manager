---
source: https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html
category: claude
scraped_at: 2026-08-14T07:50:25.347Z
---

# [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#claude-code%E5%AE%8C%E6%95%B4%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97-claude-md%E3%80%81skills%E3%80%81subagents%E3%80%81mcp%E3%80%81hooks%E3%80%81plugins%E6%80%8E%E4%B9%88%E7%94%A8) Claude Code完整使用指南：CLAUDE.md、Skills、Subagents、MCP、Hooks、Plugins怎么用

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-07-30·全文 5842 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

前面我们讲过 [Claude Code 和 Claude.ai 的区别](https://notes.kamacoder.com/llm/intro/ai-coding-three-layers.html)： **模型负责思考，Agent 内核负责读文件、改代码、跑命令和验证结果。**

也单独拆过 [CLAUDE.md 到底怎么写](https://notes.kamacoder.com/llm/claude/claude_md.html)、 [Claude Code 怎么读懂大代码库](https://notes.kamacoder.com/llm/claude/claude_code_large_codebase.html)。

但很多录友学到这里，又被一串新名词卡住了：

`CLAUDE.md`、Skills、Subagents、MCP、Hooks、Plugins，都是“给 Claude Code 加能力”，为什么要分六套？

如果一个项目全都要用，应该先配谁、后配谁？

这篇不按功能清单念文档。

我们先说它们为什么出现，再逐个讲是什么、怎么用，最后把六件东西装进同一个真实项目。

![Claude Code扩展能力封面](https://file1.kamacoder.com/i/web/20260729153227_claude_code_toolkit_01_cover-compressed.jpg)

这张图讲的是：Claude Code 从来不是靠一个“万能 Prompt”变强，而是靠一套分工清楚的工作系统。长期规则、专项流程、独立角色、外部能力、自动门禁和团队分发，各自解决一类问题。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%B8%80%E3%80%81%E4%B8%BA%E4%BB%80%E4%B9%88%E5%8F%AA%E4%BC%9A%E5%92%8C-claude-code-%E8%81%8A%E5%A4%A9-%E8%BF%9F%E6%97%A9%E4%BC%9A%E4%B9%B1) 一、为什么只会和 Claude Code 聊天，迟早会乱？

刚开始用 Claude Code，临时聊天完全够用。

“这个项目用 pnpm。”

“改完记得跑单测。”

“不要直接改数据库。”

“发版前按我们的清单检查。”

问题是，真实项目不会只聊三轮。

Claude 要读几十个文件、跑一堆命令、处理测试失败，还可能经历上下文压缩。 **你临时说过的话，会和越来越多的新信息挤在同一个上下文里。**

团队协作更麻烦。

你告诉过 Claude 的规则，换个同事、换台电脑、换个项目，又要从头再讲一遍。

![临时聊天规则被新消息淹没](https://file1.kamacoder.com/i/web/20260729153229_claude_code_toolkit_02_background-compressed.jpg)

这张图讲的是： **聊天适合表达当前任务，不能承载整套工程制度。** 规则只存在聊天里，任务一长就容易被稀释；经验只存在个人会话里，团队就无法复用。

所以 Claude Code 的扩展能力，本质上都在回答下面六个问题：

| 问题 | 应该用什么 |
| --- | --- |
| 每次进入项目都应该知道什么？ | `CLAUDE.md` |
| 某类任务应该按什么方法做？ | Skills |
| 哪些工作需要独立上下文或独立角色？ | Subagents |
| 怎么访问仓库外的系统和数据？ | MCP |
| 哪些动作命中事件就必须执行？ | Hooks |
| 怎么把整套能力发给其他项目和队友？ | Plugins |

先记住一句：

**CLAUDE.md 管常驻规则，Skill 管按需方法，Subagent 管独立干活，MCP 管外部连接，Hook 管确定性动作，Plugin 管打包分发。**

下面逐个拆。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%BA%8C%E3%80%81claude-md-%E5%85%88%E8%AE%A9-claude-%E7%9F%A5%E9%81%93-%E8%BF%99%E4%B8%AA%E9%A1%B9%E7%9B%AE%E6%80%8E%E4%B9%88%E5%B9%B2) 二、CLAUDE.md：先让 Claude 知道“这个项目怎么干”

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-claude-md-%E6%98%AF%E4%BB%80%E4%B9%88) 1\. CLAUDE.md 是什么？

`CLAUDE.md` 是 Claude Code 会自动读取的项目说明文件。

它适合放 **稳定、长期、几乎每次任务都用得上的信息**：

- 项目用什么技术栈；
- 构建、测试、格式化命令；
- 核心目录和模块边界；
- 编码规范和命名约定；
- 哪些文件不能改；
- 团队已经踩过、又很容易重踩的坑。

你可以把它理解成给新成员看的“上岗说明书”。

README 面向人，重点是项目是什么、怎么启动。

`CLAUDE.md` 面向 Agent，重点是 **接到任务以后应该怎么行动**。

![CLAUDE.md项目说明书](https://file1.kamacoder.com/i/web/20260729153231_claude_code_toolkit_03_claude_md-compressed.jpg)

这张图讲的是：长期规则不该靠程序员一遍遍口头提醒。把命令、架构和禁区写成项目说明书，Claude 每次进项目就有稳定起点。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-claude-md-%E6%94%BE%E5%9C%A8%E5%93%AA%E9%87%8C) 2\. CLAUDE.md 放在哪里？

最常用的四个位置是：

| 位置 | 作用范围 | 适合放什么 |
| --- | --- | --- |
| `~/.claude/CLAUDE.md` | 你本机的所有项目 | 个人偏好、通用工作习惯 |
| `项目根目录/CLAUDE.md` | 当前项目，团队共享 | 技术栈、命令、全局规则 |
| `项目根目录/CLAUDE.local.md` | 当前项目，仅自己使用 | 本地地址、个人测试习惯 |
| `某个子目录/CLAUDE.md` | 进入该模块时按需加载 | 模块命令、局部架构和禁区 |

项目级文件应该提交到 Git。

`CLAUDE.local.md` 通常加入 `.gitignore`，不要把个人环境信息发给全团队。

大仓库不要把所有模块规则都塞进根文件。根目录管全局，前端、支付、数据等模块各放自己的 `CLAUDE.md`。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-claude-md-%E6%80%8E%E4%B9%88%E5%86%99) 3\. CLAUDE.md 怎么写？

先从最小版本开始：

```md
## Project instructions

## Commands

- Install: `pnpm install`
- Test: `pnpm test`
- Build: `pnpm build`

## Architecture

- `apps/web/` is the frontend.
- `services/api/` is the API service.
- Shared types live in `packages/types/`.

## Rules

- Use pnpm, never npm.
- Add tests for every bug fix.
- Do not edit generated files under `dist/`.
- Never run database migrations without explicit approval.
```

1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

16

17

18

19

20

判断一条内容该不该写进去，问三个问题：

1. 以后还会反复用到吗？
2. 它会改变 Claude 的行动吗？
3. 它是否值得每个会话都占上下文？

三个答案都是“是”，再写。

发布清单、安全审查步骤、几十页 API 文档，不要全塞进来。那是 Skill 的活。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_4-claude-md-%E4%B8%8D%E6%98%AF%E5%AE%89%E5%85%A8%E8%BE%B9%E7%95%8C) 4\. CLAUDE.md 不是安全边界

这一点很重要。

`CLAUDE.md` 是行为指导，不是强制执行器。

“不要执行危险命令”写在里面，能降低误操作概率，但不能提供绝对保证。

**真正必须阻止的动作，要交给权限设置或 `PreToolUse` Hook。**

如果 Claude 没按规则做，先运行 `/memory`，确认文件是否真的加载，再检查是不是规则太模糊、太长或者彼此冲突。

更完整的拆分方法，可以继续看 [CLAUDE.md 项目记忆与上下文管理](https://notes.kamacoder.com/llm/claude/claude_md.html)。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%B8%89%E3%80%81skills-%E6%8A%8A%E9%87%8D%E5%A4%8D%E6%96%B9%E6%B3%95%E5%81%9A%E6%88%90-%E6%8C%89%E9%9C%80%E5%B7%A5%E5%85%B7%E7%AE%B1) 三、Skills：把重复方法做成“按需工具箱”

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-skill-%E8%A7%A3%E5%86%B3%E4%BB%80%E4%B9%88%E9%97%AE%E9%A2%98) 1\. Skill 解决什么问题？

假设团队有一套发布流程：

1. 检查工作区；
2. 跑测试；
3. 生成变更说明；
4. 检查数据库变更；
5. 给出回滚方案。

这套流程很重要，但你写普通业务代码时不需要它。

如果塞进 `CLAUDE.md`，Claude 每个会话都要背着它。

**Skill 的价值，就是只在相关任务出现时加载专项知识和流程。**

它既可以由你用 `/skill-name` 主动触发，也可以由 Claude 根据 `description` 自动判断。

![Claude Code按需加载Skill](https://file1.kamacoder.com/i/web/20260729153233_claude_code_toolkit_04_skills-compressed.jpg)

这张图讲的是：Skill 不是把所有资料永久堆在桌面，而是面对发布、评审、排障等具体任务时，只拿当前需要的工具箱。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-%E4%B8%80%E4%B8%AA-skill-%E9%95%BF%E4%BB%80%E4%B9%88%E6%A0%B7) 2\. 一个 Skill 长什么样？

项目级 Skill 放在：

```text
.claude/skills/release-check/
├── SKILL.md
├── checklist.md
└── scripts/
    └── verify.sh
```

1

2

3

4

5

其中 `SKILL.md` 是入口：

```md
---
name: release-check
description: Check whether the current changes are ready for release. Use for release preparation, pre-deployment review, or rollback planning.
disable-model-invocation: true
---

## Release check

1. Read `checklist.md`.
2. Inspect the current git diff.
3. Run `scripts/verify.sh`.
4. Report blockers, risks, and rollback steps.

Do not deploy. Only produce a release-readiness report.
```

1

2

3

4

5

6

7

8

9

10

11

12

13

14

这里有几个关键点：

- `description` 不是写给人看的广告，而是告诉 Claude **什么时候该加载它**；
- `disable-model-invocation: true` 表示只能由用户主动调用；
- 大段参考资料放到单独文件，`SKILL.md` 只做入口和导航；
- 脚本负责确定性检查，Claude 负责结合现场解释结果。

调用时输入：

```text
/release-check
```

1

个人通用 Skill 可以放在 `~/.claude/skills/`，项目共享 Skill 放在 `.claude/skills/`。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-%E4%BB%80%E4%B9%88%E6%97%B6%E5%80%99%E8%AF%A5%E5%81%9A-skill) 3\. 什么时候该做 Skill？

最实用的信号不是“这个知识很高级”，而是：

- 同一段说明已经复制了三次；
- `CLAUDE.md` 里某一节越来越像操作手册；
- 一个任务有固定输入、步骤和输出格式；
- 这套方法需要模板、示例或脚本；
- 多个角色都要复用同一套知识。

Skill 不是越多越好。

描述写得过宽，会在不相关任务里乱触发；内容太大，加载后一样会挤占上下文。

关于 Skill 的分类、渐进式披露和团队实践，可以继续看 [Claude Skills 实战](https://notes.kamacoder.com/llm/claude/claude_skills.html)。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%9B%9B%E3%80%81subagents-%E6%8A%8A%E5%A4%8D%E6%9D%82%E5%B7%A5%E4%BD%9C%E4%BA%A4%E7%BB%99%E7%8B%AC%E7%AB%8B%E8%A7%92%E8%89%B2) 四、Subagents：把复杂工作交给独立角色

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-%E4%B8%BA%E4%BB%80%E4%B9%88%E6%9C%89-skill-%E8%BF%98%E9%9C%80%E8%A6%81-subagent) 1\. 为什么有 Skill 还需要 Subagent？

Skill 给当前 Agent 加一套方法，但工作仍然发生在 **当前上下文**。

安全审查、全仓探索、测试排查这类任务，会读很多文件、产生大量中间输出。

如果全部塞进主会话，主 Agent 的上下文很快变脏。

更麻烦的是，让写代码的 Agent 再审自己的代码，容易产生“我已经改好了，所以应该没问题”的自我认可。

Subagent 的价值是： **另开一个独立上下文，让一个专门角色完成任务，只把结论和证据带回来。**

![Claude Code Subagents独立分工](https://file1.kamacoder.com/i/web/20260729153234_claude_code_toolkit_05_subagents-compressed.jpg)

这张图讲的是：探索、测试和审查可以由独立角色分别完成。过程噪音留在各自上下文，主 Agent 只接收有证据的结果。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-%E6%80%8E%E4%B9%88%E5%88%9B%E5%BB%BA%E4%B8%80%E4%B8%AA-subagent) 2\. 怎么创建一个 Subagent？

项目级 Subagent 放在 `.claude/agents/`：

```md
---
name: security-reviewer
description: Review code changes for authentication, authorization, injection, secret exposure, and unsafe data handling.
tools: Read, Grep, Glob, Bash
model: inherit
skills:
  - secure-coding
---

You are an independent security reviewer.

Review changes without modifying business code.

For every finding, report:

1. file and location;
2. trigger condition;
3. impact;
4. evidence;
5. recommended fix.

If no issue is found, list what you checked. Do not return only "looks good".
```

1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

16

17

18

19

20

21

22

使用时可以直接说：

```text
让 security-reviewer 独立审查这次登录模块改动，只返回带证据的结论。
```

1

也可以运行 `/agents` 查看和管理。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-%E4%BB%80%E4%B9%88%E4%BB%BB%E5%8A%A1%E9%80%82%E5%90%88%E6%8B%86-subagent) 3\. 什么任务适合拆 Subagent？

适合拆的任务通常有一个共同点： **过程很长，但主会话只需要结果。**

例如：

- 只读探索大代码库；
- 安全、性能、测试独立复核；
- 多个互不依赖模块的并行调查；
- 需要不同角色从相反角度挑错；
- 希望给角色限制工具、模型或权限。

不适合拆的情况也很明显：

- 一个文件的小修改；
- 强依赖主会话大量隐含信息；
- 多个子任务不断互相等待；
- 拆分成本比任务本身还高。

**Skill 是方法，Subagent 是拿着方法独立干活的角色。**

两者可以组合：在 Subagent 的 `skills` 字段里预加载安全规范或测试方法。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%BA%94%E3%80%81mcp-%E8%AE%A9-claude-code-%E6%8E%A5%E4%B8%8A%E4%BB%93%E5%BA%93%E5%A4%96%E7%9A%84%E4%B8%96%E7%95%8C) 五、MCP：让 Claude Code 接上仓库外的世界

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-mcp-%E5%88%B0%E5%BA%95%E6%98%AF%E4%BB%80%E4%B9%88) 1\. MCP 到底是什么？

Claude Code 自带的文件和终端工具，擅长处理当前工作区。

但真实开发还要访问很多外部系统：

- GitHub 或其他代码托管平台；
- Jira、Linear 等工单系统；
- Sentry 和日志平台；
- 数据库、数据仓库；
- 内部文档、发布平台和业务后台；
- 浏览器或设计工具。

MCP，全称 Model Context Protocol，解决的是 **AI 应用如何用统一方式发现和调用外部工具与数据**。

你不需要给每个 Agent 单独手写一套集成。

MCP Server 把能力暴露出来，Claude Code 作为 MCP Client 连接并调用。

![Claude Code通过MCP连接外部系统](https://file1.kamacoder.com/i/web/20260729153236_claude_code_toolkit_06_mcp-compressed.jpg)

这张图讲的是：MCP 像受控转接器，让 Claude Code 够到仓库外的代码平台、数据库和浏览器；权限钥匙仍然应该掌握在人和系统策略手里。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-%E6%80%8E%E4%B9%88%E7%BB%99-claude-code-%E6%B7%BB%E5%8A%A0-mcp-server) 2\. 怎么给 Claude Code 添加 MCP Server？

添加远程 HTTP Server：

```bash
claude mcp add --transport http issue-tracker https://mcp.example.com/mcp
```

1

添加本地 stdio Server：

```bash
claude mcp add --transport stdio my-tools -- node ./tools/mcp-server.js
```

1

常用检查命令：

```bash
claude mcp list
claude mcp get issue-tracker
```

1

2

进入 Claude Code 后，用 `/mcp` 查看连接和认证状态。

团队共享的项目级 MCP 配置可以写进 `.mcp.json`。从仓库拉下来的配置需要经过信任和审批，不要因为文件进了 Git 就默认它安全。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-mcp-%E6%9C%80%E5%AE%B9%E6%98%93%E8%B8%A9%E4%BB%80%E4%B9%88%E5%9D%91) 3\. MCP 最容易踩什么坑？

**第一，权限给太大。**

查询数据库就用只读账号，不要上来就给生产库写权限。

代码评审只需要读 PR，就别顺手给删仓库权限。

**第二，工具太多。**

一口气接几十个 Server、暴露几百个工具，会增加选择成本，也会污染上下文。

先接最常用、返回结果最干净的能力。

**第三，把 MCP 当成工作方法。**

MCP 只负责“能连接、能调用”。

至于查询什么、怎么判断、输出什么格式，仍然应该交给 `CLAUDE.md`、Skill 或 Subagent。

所以最常见的组合是：

**MCP 提供手和眼，Skill 提供做事方法。**

想继续理解协议层，可以看 [MCP 协议详解](https://notes.kamacoder.com/llm/app/mcp_protocol.html)。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%85%AD%E3%80%81hooks-%E8%AE%A9%E5%85%B3%E9%94%AE%E5%8A%A8%E4%BD%9C%E4%B8%8D%E5%86%8D%E4%BE%9D%E8%B5%96-%E8%AE%B0%E5%BE%97) 六、Hooks：让关键动作不再依赖“记得”

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-hook-%E5%92%8C%E6%8F%90%E9%86%92-claude-%E6%9C%89%E4%BB%80%E4%B9%88%E5%8C%BA%E5%88%AB) 1\. Hook 和提醒 Claude 有什么区别？

你在 `CLAUDE.md` 里写：

“每次改完文件都要格式化。”

这是提醒。

你配置 `PostToolUse` Hook，在编辑成功后自动运行格式化命令。

这是确定性动作。

Hooks 会在 Claude Code 生命周期的特定事件上触发，比如：

- 会话开始时注入环境信息；
- 工具执行前检查或拦截；
- 文件修改后自动格式化；
- 工具失败后记录诊断信息；
- Claude 等待确认时发桌面通知；
- 上下文压缩前保存关键状态。

![Claude Code Hooks自动门禁](https://file1.kamacoder.com/i/web/20260729153237_claude_code_toolkit_07_hooks-compressed.jpg)

这张图讲的是：格式化、测试和危险命令检查不该靠人追着提醒。Hook 像自动门禁，命中事件就执行，该通过的通过，该拦的拦住。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-%E6%80%8E%E4%B9%88%E9%85%8D%E7%BD%AE%E4%B8%80%E4%B8%AA-hook) 2\. 怎么配置一个 Hook？

Hooks 通常写在 `.claude/settings.json` 或用户级 `~/.claude/settings.json`。

下面这个例子在 Claude 使用 `Edit` 或 `Write` 后运行格式化命令：

```json
{
  "hooks": {
    "PostToolUse": [\
      {\
        "matcher": "Edit|Write",\
        "hooks": [\
          {\
            "type": "command",\
            "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write"\
          }\
        ]\
      }\
    ]
  }
}
```

1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

配置后运行 `/hooks`，确认事件、匹配器和命令是否加载。

真实项目里，建议把复杂逻辑放进独立脚本：

```json
{
  "type": "command",
  "command": ".claude/hooks/check-edited-file.sh"
}
```

1

2

3

4

这样脚本能进 Git、能单独测试，也不用把一长串 shell 塞进 JSON。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-hook-%E6%80%8E%E4%B9%88%E7%94%A8%E6%89%8D%E4%B8%8D%E4%BC%9A%E5%8F%98%E6%88%90%E6%96%B0%E5%9D%91) 3\. Hook 怎么用才不会变成新坑？

Hook 是自动执行的，所以要比普通 Prompt 更谨慎。

- 匹配范围尽量窄，不要什么事件都用 `.*`；
- 默认快速执行，重任务不要卡住每次编辑；
- 脚本要有明确退出码和错误信息；
- 不要在 Hook 里偷偷做发布、删除、推送等高风险动作；
- 先手动运行脚本，再接入 Hook；
- 需要复杂判断时，用 Skill 或独立审查 Agent，不要堆一坨 shell。

最适合 Hook 的，是“发生到这里就必须做”的动作。

最不适合 Hook 的，是需要阅读大量上下文、权衡多个方案的开放问题。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%B8%83%E3%80%81plugins-%E6%8A%8A%E4%B8%80%E5%A5%97%E8%83%BD%E5%8A%9B%E5%8F%98%E6%88%90%E5%9B%A2%E9%98%9F%E5%8F%AF%E5%AE%89%E8%A3%85%E7%9A%84%E4%BA%A7%E5%93%81) 七、Plugins：把一套能力变成团队可安装的产品

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-plugin-%E4%B8%8D%E6%98%AF%E7%AC%AC%E4%B8%83%E7%A7%8D%E8%83%BD%E5%8A%9B) 1\. Plugin 不是第七种能力

很多录友把 Plugin 理解成“又一个工具”。

其实它更像 **包装和分发格式**。

一个 Plugin 可以同时带上：

- Skills；
- Subagents；
- Hooks；
- MCP Server 配置；
- LSP 配置；
- 其他可复用组件。

你在一个项目的 `.claude/` 目录里做实验，适合快速迭代。

当这套配置已经稳定，需要跨项目、跨团队安装、升级和版本管理时，再把它做成 Plugin。

![Claude Code Plugin团队分发](https://file1.kamacoder.com/i/web/20260729153239_claude_code_toolkit_08_plugins-compressed.jpg)

这张图讲的是：Plugin 把零散的 Skill、Agent、Hook 和 MCP 配置装进同一个团队工具包。一份维护、多人复用，才不会每台电脑手工配一遍。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-%E6%80%8E%E4%B9%88%E5%AE%89%E8%A3%85-plugin) 2\. 怎么安装 Plugin？

在 Claude Code 里输入：

```text
/plugin
```

1

可以打开插件面板，浏览、安装和管理插件。

安装官方市场中的插件：

```text
/plugin install github@claude-plugins-official
```

1

先看清插件提供什么组件、需要什么权限、会连接哪些外部系统。

安装插件不是给它无限授权。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-%E4%B8%80%E4%B8%AA%E8%87%AA%E5%AE%9A%E4%B9%89-plugin-%E9%95%BF%E4%BB%80%E4%B9%88%E6%A0%B7) 3\. 一个自定义 Plugin 长什么样？

最小目录可以是：

```text
team-toolkit/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── release-check/
│       └── SKILL.md
├── agents/
│   └── security-reviewer.md
├── hooks/
│   └── hooks.json
└── .mcp.json
```

1

2

3

4

5

6

7

8

9

10

11

`plugin.json` 描述插件身份：

```json
{
  "name": "team-toolkit",
  "description": "Shared release and review workflows for our engineering team",
  "version": "1.0.0"
}
```

1

2

3

4

5

本地开发时，可以用 `--plugin-dir` 加载：

```bash
claude --plugin-dir ./team-toolkit
```

1

先在一两个项目里把组件跑稳，再发布到团队市场。

**Plugin 解决的是分发，不会自动修复里面写得很差的 Skill、过宽的 Hook 或权限过大的 MCP。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%85%AB%E3%80%81%E5%85%AD%E7%A7%8D%E8%83%BD%E5%8A%9B%E6%80%8E%E4%B9%88%E7%BB%84%E5%90%88-%E7%9C%8B%E4%B8%80%E4%B8%AA%E7%9C%9F%E5%AE%9E%E9%A1%B9%E7%9B%AE) 八、六种能力怎么组合？看一个真实项目

假设录友正在给电商系统增加“退款审批”功能。

这个功能涉及业务规则、数据库、权限、测试、工单和发布。

正确做法不是把所有要求塞进一个超级 Prompt，而是按问题分层。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-claude-md-%E6%94%BE%E6%AF%8F%E6%AC%A1%E9%83%BD%E8%A6%81%E7%9F%A5%E9%81%93%E7%9A%84%E7%A8%B3%E5%AE%9A%E4%BA%8B%E5%AE%9E) 1\. CLAUDE.md：放每次都要知道的稳定事实

```md
- Money is stored in cents as integer values.
- Refund APIs must be idempotent.
- All approval actions require an audit log.
- Run `pnpm test:payments` after changing the payment module.
- Never run production migrations without explicit approval.
```

1

2

3

4

5

这些规则和某一次任务无关，任何支付改动都应该知道。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-skill-%E4%BF%9D%E5%AD%98%E9%80%80%E6%AC%BE%E8%AF%84%E5%AE%A1%E6%96%B9%E6%B3%95) 2\. Skill：保存退款评审方法

创建 `refund-review` Skill，里面放：

- 幂等检查清单；
- 金额精度规则；
- 审批状态机说明；
- 审计字段要求；
- 测试模板；
- 输出报告格式。

以后每次做退款功能，不用重新复制几十行要求。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-subagent-%E7%8B%AC%E7%AB%8B%E5%81%9A%E5%AE%89%E5%85%A8%E5%A4%8D%E6%A0%B8) 3\. Subagent：独立做安全复核

让 `payment-security-reviewer` 只读检查：

- 是否能越权审批；
- 重放请求会不会重复退款；
- 日志是否泄露敏感信息；
- 状态转换是否能绕过；
- 有没有带证据的测试。

主 Agent 不参与它的推理，只接收结论，再决定怎么改。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_4-mcp-%E8%BF%9E%E6%8E%A5%E7%9C%9F%E5%AE%9E%E5%B7%A5%E7%A8%8B%E7%B3%BB%E7%BB%9F) 4\. MCP：连接真实工程系统

通过 MCP：

- 读取退款工单；
- 查询错误平台中的历史异常；
- 查看代码托管平台上的 PR；
- 用只读账号查询测试环境数据。

连接负责拿到真实信息，判断规则仍然来自项目说明和 Skill。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_5-hooks-%E8%87%AA%E5%8A%A8%E6%89%A7%E8%A1%8C%E7%A1%AC%E6%A3%80%E6%9F%A5) 5\. Hooks：自动执行硬检查

- 修改支付代码后自动跑格式化和静态扫描；
- 执行数据库命令前检查环境；
- 准备提交时确认关键测试是否通过；
- Claude 等待审批时给开发者发送通知。

不用指望 Agent 每次都“自觉记住”。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_6-plugin-%E6%8A%8A%E6%88%90%E7%86%9F%E6%96%B9%E6%A1%88%E5%8F%91%E7%BB%99%E5%85%A8%E5%9B%A2%E9%98%9F) 6\. Plugin：把成熟方案发给全团队

当退款 Skill、安全 Subagent、Hooks 和 MCP 配置都跑稳后，打包成 `payment-engineering` Plugin。

新同事安装以后，拿到的是同一套能力，不是某个人口口相传的经验。

这时候六层的关系就很清楚了：

```text
CLAUDE.md：告诉 Claude 这个项目长期怎么做
Skill：告诉 Claude 这类任务具体怎么做
Subagent：安排一个独立角色去做
MCP：给这个角色接上外部工具和数据
Hook：在关键节点自动检查和拦截
Plugin：把前面几层打包给团队
```

1

2

3

4

5

6

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E4%B9%9D%E3%80%81%E4%BB%8E%E9%9B%B6%E5%BC%80%E5%A7%8B-%E5%BA%94%E8%AF%A5%E6%8C%89%E4%BB%80%E4%B9%88%E9%A1%BA%E5%BA%8F%E9%85%8D%E7%BD%AE) 九、从零开始，应该按什么顺序配置？

不要第一天就安装几十个 Plugin、接十几个 MCP、开一队 Subagents。

配置越多，冲突、权限和上下文成本也越高。

建议按问题出现的顺序来：

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E4%B8%80%E6%AD%A5-%E5%85%88%E6%8A%8A%E6%A0%B9-claude-md-%E5%86%99%E5%88%B0%E8%83%BD%E7%94%A8) 第一步：先把根 CLAUDE.md 写到能用

只写命令、架构、禁区和最常见的坑。

运行 `/memory` 确认它被加载。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E4%BA%8C%E6%AD%A5-%E6%8A%8A%E9%87%8D%E5%A4%8D%E5%87%BA%E7%8E%B0%E7%9A%84%E6%B5%81%E7%A8%8B%E5%81%9A%E6%88%90%E4%B8%80%E4%B8%AA-skill) 第二步：把重复出现的流程做成一个 Skill

从最常复制的发布、评审或排障流程开始。

运行 `/skills` 检查描述和作用域。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E4%B8%89%E6%AD%A5-%E7%BB%99-%E5%BF%85%E9%A1%BB%E5%8F%91%E7%94%9F-%E7%9A%84%E5%8A%A8%E4%BD%9C%E5%8A%A0-hook) 第三步：给“必须发生”的动作加 Hook

先接格式化、lint、危险命令拦截这类确定动作。

运行 `/hooks` 检查配置，手动验证成功和失败路径。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E5%9B%9B%E6%AD%A5-%E5%8F%AA%E4%B8%BA%E6%98%8E%E7%A1%AE%E5%9C%BA%E6%99%AF%E5%88%9B%E5%BB%BA-subagent) 第四步：只为明确场景创建 Subagent

优先做安全审查或大范围只读探索。

运行 `/agents` 检查它能用哪些工具、模型和 Skills。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E4%BA%94%E6%AD%A5-%E6%8C%89%E7%9C%9F%E5%AE%9E%E9%9C%80%E6%B1%82%E6%8E%A5-mcp) 第五步：按真实需求接 MCP

先接一个高频系统，给最小权限。

运行 `/mcp` 查看认证和连接状态。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E7%AC%AC%E5%85%AD%E6%AD%A5-%E7%A8%B3%E5%AE%9A%E4%BB%A5%E5%90%8E%E5%86%8D%E5%81%9A-plugin) 第六步：稳定以后再做 Plugin

先证明这套能力在项目里真的有用，再考虑跨项目分发。

插件化太早，只会把还没想清楚的配置更快地复制出去。

遇到配置不生效，还可以运行：

```text
/doctor
/status
/permissions
```

1

2

3

先确认“有没有加载、从哪里加载、最终权限是什么”，再怀疑模型。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%8D%81%E3%80%81%E6%9C%80%E5%AE%B9%E6%98%93%E9%85%8D%E9%94%99%E7%9A%84%E5%85%AD%E4%B8%AA%E5%9C%B0%E6%96%B9) 十、最容易配错的六个地方

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_1-%E6%8A%8A-claude-md-%E5%86%99%E6%88%90%E7%99%BE%E7%A7%91%E5%85%A8%E4%B9%A6) 1\. 把 CLAUDE.md 写成百科全书

问题：每轮都占上下文，真正重要的规则反而不突出。

改法：稳定事实留下，专项流程移到 Skill，长资料按需加载。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_2-skill-%E7%9A%84-description-%E5%86%99%E5%BE%97%E5%A4%AA%E7%A9%BA) 2\. Skill 的 description 写得太空

问题：“帮助开发”这种描述什么都能匹配，也等于什么都没说。

改法：写清任务、触发语境和不适用范围。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_3-%E4%B8%BA%E4%BA%86-%E5%B9%B6%E8%A1%8C-%E6%BB%A5%E7%94%A8-subagents) 3\. 为了“并行”滥用 Subagents

问题：拆任务、传上下文、汇总结果都要成本。

改法：只有任务能独立完成，或者过程噪音确实需要隔离时再拆。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_4-mcp-%E4%B8%80%E4%B8%8A%E6%9D%A5%E5%B0%B1%E8%BF%9E%E7%94%9F%E4%BA%A7%E5%86%99%E6%9D%83%E9%99%90) 4\. MCP 一上来就连生产写权限

问题：接入范围扩大，误操作半径也跟着扩大。

改法：只读优先、最小权限、敏感动作保留人工确认。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_5-hook-%E5%81%9A%E5%BE%97%E5%8F%88%E9%87%8D%E5%8F%88%E5%AE%BD) 5\. Hook 做得又重又宽

问题：每次编辑都卡住，还可能对不相关文件误执行。

改法：缩小 matcher，把复杂逻辑放到可测试脚本，重任务改成按需 Skill。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#_6-%E6%8A%8A-plugin-%E5%BD%93-%E8%A3%85%E5%BE%97%E8%B6%8A%E5%A4%9A%E8%B6%8A%E5%BC%BA) 6\. 把 Plugin 当“装得越多越强”

问题：组件可能互相冲突，工具列表膨胀，权限来源也变得难审计。

改法：只安装能解决明确问题的插件，定期用诊断命令检查来源。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%8D%81%E4%B8%80%E3%80%81%E5%87%A0%E4%B8%AA%E9%AB%98%E9%A2%91%E9%97%AE%E9%A2%98) 十一、几个高频问题

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#claude-md-%E5%92%8C%E8%87%AA%E5%8A%A8-memory-%E6%9C%89%E4%BB%80%E4%B9%88%E5%8C%BA%E5%88%AB) CLAUDE.md 和自动 Memory 有什么区别？

`CLAUDE.md` 是团队明确维护的项目规则，可以进 Git、可以评审。

自动 Memory 是 Claude 在使用过程中积累的本机经验，适合保存调试发现和个人工作习惯。

团队制度写进 `CLAUDE.md`，不要等自动 Memory 自己猜。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#skill-%E5%92%8C-hook-%E5%88%B0%E5%BA%95%E6%80%8E%E4%B9%88%E9%80%89) Skill 和 Hook 到底怎么选？

需要结合上下文判断、执行一套方法，用 Skill。

命中事件就必须执行，而且结果应该稳定可验证，用 Hook。

例如“按团队标准审查 PR”是 Skill，“编辑后自动格式化”是 Hook。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#skill-%E5%92%8C-subagent-%E5%88%B0%E5%BA%95%E6%80%8E%E4%B9%88%E9%80%89) Skill 和 Subagent 到底怎么选？

希望给当前上下文补知识，用 Skill。

希望把长过程隔离出去，只拿结果回来，用 Subagent。

如果一个安全角色需要固定审查方法，就让 Subagent 预加载对应 Skill。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#mcp-%E5%92%8C-plugin-%E5%88%B0%E5%BA%95%E6%98%AF%E4%BB%80%E4%B9%88%E5%85%B3%E7%B3%BB) MCP 和 Plugin 到底是什么关系？

MCP 是连接协议，解决“Claude 怎么调用外部系统”。

Plugin 是分发包，解决“怎么把 MCP 配置连同 Skills、Agents、Hooks 一起发给别人”。

### [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E9%85%8D%E9%BD%90%E5%85%AD%E4%BB%B6%E5%A5%97-%E5%B0%B1%E4%B8%80%E5%AE%9A%E6%9B%B4%E5%A5%BD%E5%90%97) 配齐六件套，就一定更好吗？

不一定。

这些能力不是等级勋章。

一个小项目可能只需要 30 行 `CLAUDE.md` 和一个格式化 Hook。只有重复流程出现了，才加 Skill；只有上下文需要隔离，才加 Subagent；只有仓库外能力确实要用，才接 MCP。

**最好的 Claude Code 配置，不是组件最多，而是每一层都在解决真实问题。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html\#%E5%8F%82%E8%80%83%E9%93%BE%E6%8E%A5) 参考链接

- Claude Code 官方文档（扩展能力总览）：https://code.claude.com/docs/en/features-overview
- Claude Code 官方文档（CLAUDE.md 与 Memory）：https://code.claude.com/docs/en/memory
- Claude Code 官方文档（Skills）：https://code.claude.com/docs/en/slash-commands
- Claude Code 官方文档（Subagents）：https://code.claude.com/docs/en/sub-agents
- Claude Code 官方文档（MCP）：https://code.claude.com/docs/en/mcp
- Claude Code 官方文档（Hooks）：https://code.claude.com/docs/en/hooks-guide
- Claude Code 官方文档（Plugins）：https://code.claude.com/docs/en/plugins

←
[Claude Code高效使用指南](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html)[CLAUDE.md到底怎么写](https://notes.kamacoder.com/llm/claude/claude_md.html)
→


### 评论

登录后评论登录