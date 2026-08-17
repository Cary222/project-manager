---
source: https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html
category: claude
scraped_at: 2026-08-14T08:03:32.668Z
---

# [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#claude-code-%E9%AB%98%E6%95%88%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97-%E5%88%AB%E6%8A%8A%E5%AE%83%E5%BD%93%E8%81%8A%E5%A4%A9%E6%A1%86-5-%E4%BB%B6%E4%BA%8B%E6%8A%8A%E5%AE%83%E8%B0%83%E6%95%99%E6%88%90%E4%B8%80%E4%B8%AA%E4%BC%9A%E8%87%AA%E5%B7%B1%E5%B9%B2%E6%B4%BB%E7%9A%84%E5%9B%A2%E9%98%9F) Claude Code 高效使用指南：别把它当聊天框，5 件事把它调教成一个会自己干活的团队

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-07-30·全文 1857 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

录友们好，今天聊一个用的人多、但用对的人少的工具： **Claude Code**。

我观察了一圈，绝大多数人装好 Claude Code 之后，就把它当成一个「会写代码的聊天框」——打开终端，问一句，答一句，复制粘贴，关掉。

这么用没错，但没发挥他的价值。

Claude Code 真正的价值不在「它能写代码」，而在于：你能把它从一个 **每次都得从头解释一遍的临时工**，调教成一个 **懂你项目、能自己干活、还能并行开多线程的团队**。这中间差的，就是下面这几件事。

前面我们专门讲过 [CLAUDE.md 到底怎么写](https://notes.kamacoder.com/llm/claude/claude_md.html)、 [Claude Code 作者说"不写 Prompt，写 Loop"](https://notes.kamacoder.com/llm/claude/claude_code_loop.html)、 [Claude Code 为什么快](https://notes.kamacoder.com/llm/claude/claude_prompt_cache.html)，那几篇是单点深挖。这一篇把它们串起来，给你一条「从能用到用得高效」的完整路线。

如果你还分不清 CLAUDE.md、Skills、Subagents、MCP、Hooks、Plugins 各自管什么，先看这篇 [Claude Code 扩展能力完整指南](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html)，里面给了目录、配置和组合案例。

![Claude Code 高效使用的逐级固化阶梯：从聊天框到 CLAUDE.md、Skill、Hooks、子代理与动态工作流，越往上自动化程度越高越省心](https://file1.kamacoder.com/i/web/20260624112225.png)

这张图回答的是： **怎么把 Claude Code 从「聊天框」一步步用高效**。底座那个红色「聊天框」就是大多数人停留的浅用法——问一句答一句、每次从零解释。往上每一级，都是把一类「重复劳动」固化下来：项目规则固化进 CLAUDE.md、专项流程固化成 Skill、必做动作固化成 Hooks、大任务固化成并行编排。固化得越多，你要操的心越少。下面就顺着这条阶梯一级一级讲。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E7%AC%AC%E4%B8%80%E4%BB%B6%E4%BA%8B-%E5%88%AB%E8%AE%A9%E5%AE%83%E6%AF%8F%E6%AC%A1%E9%83%BD%E3%80%8C%E4%BB%8E%E9%9B%B6%E8%AE%A4%E8%AF%86%E4%BD%A0%E7%9A%84%E9%A1%B9%E7%9B%AE%E3%80%8D) 第一件事：别让它每次都「从零认识你的项目」

新会话里的 Claude Code，是 **失忆** 的。它不知道你用什么技术栈、不知道你的代码规范、不知道这个项目哪几个坑不能踩。

你每次都口头交代一遍，就是在重复劳动。 **正确的做法是把这些写进 `CLAUDE.md`**——放在项目根目录的一个 markdown 文件，Claude Code 每次开会话都会先读它。编码规范、架构决策、常用命令、踩过的坑，全写进去。

光这一步，就能把「它写出来的东西不符合我项目习惯」这类问题砍掉一大半。

更省心的是，Claude 干活时还会自己攒 **自动内存**——构建命令、调试发现这些东西，它会跨会话记住，不用你写。怎么把 CLAUDE.md 写得既管用又不臃肿， [这一篇](https://notes.kamacoder.com/llm/claude/claude_md.html) 讲得很细，这里不重复。

**一句话：CLAUDE.md 是你给 Claude 的「项目说明书」，写一次，每个会话都受益。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E7%AC%AC%E4%BA%8C%E4%BB%B6%E4%BA%8B-%E6%8A%8A%E3%80%8C%E6%AF%8F%E6%AC%A1%E9%83%BD%E8%A6%81%E8%A7%A3%E9%87%8A%E4%B8%80%E9%81%8D%E7%9A%84%E6%B5%81%E7%A8%8B%E3%80%8D%E5%B0%81%E6%88%90-skill) 第二件事：把「每次都要解释一遍的流程」封成 Skill

CLAUDE.md 解决的是「always-on 的项目规则」，但有些活儿是 **特定场景才用** 的——比如「发版前怎么写 release notes」「我们团队的 PR 评审清单」「部署到 staging 的固定步骤」。

这些东西塞进 CLAUDE.md，会把它撑爆、还白占上下文。 **它们该被封成 Skill。**

Skill 是 **按需加载的专项能力**：平时不占上下文，Claude 判断这次任务用得上，才把它调起来，像 `/review-pr`、`/deploy-staging` 这样一键触发。而且 Skill 不是一个 markdown 文件，是一个 **文件夹**——可以带脚本、带模板、带参考资料。

Anthropic 内部已经在用 **几百个 Skill**，他们总结的实战经验我单独写过一篇 [Claude Skills 实战](https://notes.kamacoder.com/llm/claude/claude_skills.html)，想认真用 Skill 的录友建议读一下。

**一句话：重复三次以上的流程，就该封成 Skill，让团队共享。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E7%AC%AC%E4%B8%89%E4%BB%B6%E4%BA%8B-%E6%8A%8A%E3%80%8C%E6%AF%8F%E6%AC%A1%E9%83%BD%E5%BE%97%E6%89%8B%E5%8A%A8%E5%81%9A%E7%9A%84%E4%BA%8B%E3%80%8D%E4%BA%A4%E7%BB%99-hooks-%E8%87%AA%E5%8A%A8%E8%B7%91) 第三件事：把「每次都得手动做的事」交给 Hooks 自动跑

有些事不是「让 Claude 决定做不做」，而是 **每次都必须做**——比如每次改完文件自动格式化、提交前必须跑一遍 lint。

这种事靠你盯着、靠提醒 Claude，都不靠谱。 **这是 Hooks 的活儿。**

Hooks 让你在 Claude Code 动手 **之前或之后** 自动执行 shell 命令。配一条「文件编辑后自动 format」、一条「commit 前先 lint」，从此这些动作脱离「人的注意力」，变成确定性发生的流程。

**Skill 和 Hooks 的区别记住这一句：Skill 是「需要时才调的能力」，Hooks 是「每次都确定触发的动作」。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E7%AC%AC%E5%9B%9B%E4%BB%B6%E4%BA%8B-%E5%A4%A7%E6%B4%BB%E5%84%BF%E5%88%AB%E4%B8%80%E4%B8%AA%E4%BA%BA%E6%89%9B-%E5%AD%90%E4%BB%A3%E7%90%86%E5%92%8C%E5%8A%A8%E6%80%81%E5%B7%A5%E4%BD%9C%E6%B5%81) 第四件事：大活儿别一个人扛——子代理和动态工作流

深度调研、安全审计、大范围重构这种活儿，让 **一个** Claude 从头干到尾，上下文很快就撑满，还容易跑偏、偷懒、自夸。

Claude Code 的解法是 **开一队 Claude 并行**：

- **子代理（sub-agents）**：主代理把任务拆成几块，分给多个子代理同时干，最后自己汇总合并。每个子代理有独立上下文，互不污染。
- **动态工作流（Dynamic Workflows）**：更进一步，Claude 针对你 **当前这个任务**，现场写一套专属的编排（扇出汇总、对抗验证、锦标赛等模式），把活儿拆给一队 Claude 去跑。

这套「为什么要拆、怎么拆」的工程思路，我在 [Managed Agents](https://notes.kamacoder.com/llm/claude/managed_agents.html) 和 [动态工作流详解](https://notes.kamacoder.com/llm/claude/dynamic_workflows.html) 两篇里讲透了。

**一句话：上下文是稀缺资源，活儿大就拆开并行，别让一个 Claude 硬扛。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E7%AC%AC%E4%BA%94%E4%BB%B6%E4%BA%8B-%E8%B7%B3%E5%87%BA%E8%81%8A%E5%A4%A9%E6%A1%86-cli-%E7%AE%A1%E9%81%93-%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1) 第五件事：跳出聊天框——CLI 管道 + 定时任务

很多录友只在「交互式聊天」里用 Claude Code，其实它遵循 Unix 哲学， **是可以管道化、能塞进脚本和 CI 的**。

用 `claude -p`（print 模式）就能把它当成命令行里的一环：

```bash
# 盯日志，发现异常就 Slack 我
tail -200 app.log | claude -p "如果发现任何异常就 Slack 通知我"

# 批量审查改动文件的安全问题
git diff main --name-only | claude -p "审查这些改动文件有没有安全问题"
```

1

2

3

4

5

再往上一层是 **定时任务**，让重复的活儿自动发生：早晨 PR 审查、夜里跑 CI 失败分析、每周依赖审计。

- 终端里临时轮询，用 [`/loop`](https://notes.kamacoder.com/llm/claude/claude_code_loop.html)（这背后就是「写 Loop 不写 Prompt」那套思路）；
- 想要 **电脑关机也照跑** 的，用 **Routines**——它跑在 Anthropic 托管的基础设施上，还能被 API 调用或 GitHub 事件触发。

**一句话：能用一句话提问，也能塞进管道和定时任务无人值守地跑——后者才是效率的天花板。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E6%9C%80%E5%90%8E-%E6%8D%A2%E4%B8%AA%E5%9C%B0%E6%96%B9%E6%8E%A5%E7%9D%80%E5%B9%B2) 最后：换个地方接着干

Claude Code 不绑死在一个界面。终端、VS Code / JetBrains、桌面 App、网页，背后是 **同一个引擎**——你的 CLAUDE.md、设置、MCP 服务器在哪儿都通用。

离开工位，用手机或浏览器 **远程接管** 正在跑的会话；网页或 iOS 上起一个长任务，回头用 `claude --teleport` 把它拽回终端继续。 **工作跟着你走，不跟着设备走。**

说到底，高效用 Claude Code 就一条主线： **把"每次都要重复的东西"一层层固化下来**——项目规则固化进 CLAUDE.md，专项流程固化成 Skill，必做动作固化成 Hooks，大任务固化成并行编排。固化得越多，你要操的心越少。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_efficient_guide.html\#%E5%8F%82%E8%80%83%E9%93%BE%E6%8E%A5) 参考链接

- Claude Code 官方文档（概述）：https://code.claude.com/docs/zh-CN/overview
- Claude Code 官方文档（常见工作流）：https://code.claude.com/docs/zh-CN/common-workflows

←
[专栏介绍与学习路线](https://notes.kamacoder.com/llm/claude/)[Claude Code扩展能力完整指南](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html)
→


### 评论

登录后评论登录