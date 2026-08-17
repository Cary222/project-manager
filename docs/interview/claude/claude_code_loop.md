---
source: https://notes.kamacoder.com/llm/claude/claude_code_loop.html
category: claude
scraped_at: 2026-08-14T07:51:13.981Z
---

# [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#claude-code%E4%BD%9C%E8%80%85%E8%AF%B4-%E4%B8%8D%E5%86%99prompt-%E5%86%99loop-ai%E7%BC%96%E7%A8%8B%E4%BB%8E%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%88%B0agent%E9%97%AD%E7%8E%AF%E5%88%B0%E5%BA%95%E5%8F%98%E4%BA%86%E4%BB%80%E4%B9%88) Claude Code作者说“不写Prompt，写Loop”：AI编程从提示词到Agent闭环到底变了什么

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-07-30·全文 3535 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

录友们好，今天继续聊 Claude Code。

前面我们讲过 [CLAUDE.md 到底怎么写(opens new window)](https://mp.weixin.qq.com/s/UchpOfemclpAoPIk2ToNCw)，还拆过 [Claude Code 怎么读懂大代码库(opens new window)](https://mp.weixin.qq.com/s/by51ptT2qumwN3hTrq3FeA)。

这几篇文章其实一直在讲同一个问题：

**AI 编程不是把模型换强一点就完了。**

模型很重要，但真正决定体验的，是模型外面那层 Agent 内核、工具系统、项目记忆、验证流程、权限边界。

最近 Claude Code 作者 Boris Cherny 有一句话被很多人讨论：

> 不少读者问我，如何充值Claude会员，我在这里篇单独讲一下： [国内Claude充值会员的方法](https://notes.kamacoder.com/qita/0002.claudepay.html)

**“我已经不写 prompt 了，我写 loop。”**

![](https://file1.kamacoder.com/i/web/2026-06-09_11-33-20.jpg)

完整采访视频，大家可以去B站搜一下，选一个带字母的，看起来舒服一下。

![](https://file1.kamacoder.com/i/web/2026-06-09_11-35-50.jpg)

过去很多人以为，AI 编程的核心能力是“怎么写一句更聪明的提示词”。

现在越来越明显： **真正有价值的不是写一句 prompt，而是把任务设计成一个能持续推进、自动验证、出错能纠偏、该停能停下来的 loop。**

这就是今天要讲的重点。

![Prompt 到 Loop 的 AI 编程范式迁移图](https://file1.kamacoder.com/i/web/20260609100829_claude_code_loop_01_prompt_to_loop_compressed.png)

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%B8%80%E3%80%81%E4%B8%BA%E4%BB%80%E4%B9%88%E5%8F%AA%E5%86%99-prompt-%E4%B8%8D%E5%A4%9F%E4%BA%86) 一、为什么只写 Prompt 不够了？

先别急着把 prompt 贬得一文不值。

Prompt 当然有用。

你问一个概念，让 AI 解释一下。

你贴一段代码，让 AI 帮你改写。

你让它生成一个 SQL、一个正则、一个接口文档。

这些场景里，prompt 就够了。

因为任务短、边界清楚、结果也容易人工判断。

但 AI 编程不是只做这种小任务。

真实项目里，你让 Claude Code 修一个 bug，往往不是一句话就能完成。

它要先读代码。

要定位调用链。

要判断哪个文件该改，哪个文件不能动。

要修改实现。

要跑测试。

测试失败了，还要回头看日志。

日志里可能暴露了另一个问题。

修完之后，还要确认没有引入新的副作用。

这时候你会发现， **prompt 只是任务的起点，不是任务的完成机制。**

你写一句：

“帮我修一下登录失败的问题。”

这句话只表达了目标。

但它没有说：

- 去哪里找入口
- 哪些文件不能动
- 怎么判断修好了
- 测试失败了怎么办
- 什么时候必须停下来问人
- 什么改动算越界

这些东西如果都靠模型自己猜，就会出现两个问题。

第一，模型会浪费大量上下文摸索。

第二，模型可能看起来很努力，最后却朝错方向越走越远。

很多录友说“AI 写代码不稳定”，根源不是它每一行代码都差。

而是你只给了它一个 prompt，却没有给它一个能稳定工作的闭环。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%BA%8C%E3%80%81loop-%E5%88%B0%E5%BA%95%E6%98%AF%E4%BB%80%E4%B9%88) 二、Loop 到底是什么？

Loop 不是玄学。

也不是让 AI 一直自动跑，跑到天荒地老。

一个最小的 Agent Loop，大概是这样：

**目标 → 计划 → 执行 → 观察 → 验证 → 反馈 → 下一步**

如果验证通过，就停止。

如果验证失败，就把失败信息带回去，重新计划。

如果触碰边界，就暂停，让人决策。

这才叫 loop。

![Agent Loop 的最小闭环结构图](https://file1.kamacoder.com/i/web/20260609100830_claude_code_loop_02_minimal_loop_compressed.png)

你看，这和普通 prompt 的差别很大。

普通 prompt 更像是：

“我说一句，你答一句。”

Loop 更像是：

“我给你目标、工具、规则和验收标准，你自己推进，但每一步都要留下证据。”

这也是为什么 Claude Code 这类工具和网页聊天框差别很大。

网页聊天框里，你主要是在和模型对话。

Claude Code 里，模型不是只回答你。

它会读文件、搜代码、改文件、跑命令、看报错、继续修。

这些动作串起来，才是 Agent Loop。

所以 Boris 说“不写 prompt，写 loop”，不是说一句提示词都不写了。

而是说： **不要把 AI 编程理解成“我怎么问得更好”，要理解成“我怎么设计一个可执行的闭环”。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%B8%89%E3%80%81%E5%9D%8F-loop-%E6%AF%94%E5%9D%8F-prompt-%E6%9B%B4%E5%8D%B1%E9%99%A9) 三、坏 Loop 比坏 Prompt 更危险

这里我要泼点冷水。

Loop 听起来高级，但坏 loop 很危险。

一个坏 prompt，最多就是回答不理想。

一个坏 loop，可能会一直跑、一直改、一直消耗 token，还可能把项目改乱。

很多人第一次用 Agent 工具，容易上来就说：

“你自己看着办，直到修好为止。”

这句话听起来很潇洒。

但对 Agent 来说，这就是一个危险指令。

因为“修好”没有被定义。

没有测试。

没有验收标准。

没有权限边界。

没有停止条件。

那它只能自己脑补。

脑补就会出事。

![坏 Loop 和好 Loop 的差异路径图](https://file1.kamacoder.com/i/web/20260609100832_claude_code_loop_03_bad_vs_good_loop_compressed.png)

好的 loop 至少要有四个东西：

**第一，有明确目标。**

不是“优化一下性能”，而是“让接口 P95 从 800ms 降到 300ms 以内，不能改变返回结构”。

**第二，有可执行工具。**

不能只让它想。

要能读代码、跑测试、看日志、查文档、调用脚本。

**第三，有验证反馈。**

测试结果、lint 结果、构建结果、接口返回、日志差异，这些都要能回到上下文里。

**第四，有停止条件。**

什么时候算完成？

什么时候算失败？

什么时候必须停下来问人？

这四个东西缺一个，loop 就会变成“AI 自己猜自己对不对”。

这种用法，不是先进。

是危险。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E5%9B%9B%E3%80%81prompt-%E5%B7%A5%E7%A8%8B%E5%92%8C-loop-%E5%B7%A5%E7%A8%8B%E4%B8%8D%E6%98%AF%E4%B8%80%E5%9B%9E%E4%BA%8B) 四、Prompt 工程和 Loop 工程不是一回事

很多录友之前学 prompt engineering，重点是怎么把一句话写清楚。

比如：

- 给角色
- 给背景
- 给输出格式
- 给示例
- 给约束

这些还要不要？

当然要。

但在 Agent 场景里，这些只是第一层。

更重要的是 loop engineering。

它关心的是：

- 任务怎么拆
- 信息怎么进上下文
- 工具怎么调用
- 失败怎么反馈
- 规则怎么长期保存
- 验收怎么自动化
- 权限怎么限制
- 成本怎么控制

你会发现，这已经不是“文案能力”了。

这更像工程能力。

![Prompt 工程和 Loop 工程的能力边界对比图](https://file1.kamacoder.com/i/web/20260609100834_claude_code_loop_04_prompt_vs_loop_engineering_compressed.png)

举个例子。

你让 Claude Code 修改一个支付回调 bug。

只写 prompt 的人会说：

“帮我修一下支付回调偶尔失败的问题，注意代码质量。”

这太虚了。

会写 loop 的人会这样给任务：

“先从支付回调入口开始读，不要修改数据库迁移文件。定位失败原因后，给出改动计划。修改完成后跑支付模块单测，如果测试失败，优先根据错误日志修复；如果涉及幂等逻辑或金额计算，先停下来说明风险，不要直接改核心规则。”

你看，这里不是提示词更华丽。

而是它把 loop 的关键部件放进去了：

- 搜索入口
- 禁止修改范围
- 计划阶段
- 测试反馈
- 错误恢复
- 高风险暂停点

这就是差别。

**Prompt 工程解决“模型怎么回答”。**

**Loop 工程解决“任务怎么被可靠完成”。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%BA%94%E3%80%81claude-code-%E4%B8%BA%E4%BB%80%E4%B9%88%E5%A4%A9%E7%84%B6%E9%80%82%E5%90%88-loop) 五、Claude Code 为什么天然适合 Loop？

Claude Code 的价值，不是它把 Claude 模型搬进了终端。

如果只是终端里聊天，那没什么稀奇。

它真正厉害的地方，是把 AI 编程常见动作做成了可循环执行的系统。

一个真实的 Claude Code 工作流大概是这样：

你给一个目标。

它先读项目规则，比如 `CLAUDE.md`。

然后用搜索工具找入口。

读相关文件。

形成修改计划。

改代码。

跑命令。

看输出。

如果报错，就把错误日志作为新证据，继续修。

如果测试通过，就收束改动，给你结果。

![Claude Code 从读代码到验证结果的 Agent Loop 工作流图](https://file1.kamacoder.com/i/web/20260609100836_claude_code_loop_05_claude_code_workflow_compressed.png)

这套东西看起来像“AI 会自己干活”。

但拆开看，里面都是工程问题：

搜索准不准。

上下文有没有污染。

工具返回值够不够清楚。

测试命令能不能跑。

错误信息有没有被正确利用。

权限边界有没有卡住。

所以我一直说，Claude Code 不是一个“更聪明的聊天框”。

它是一个 Agent 执行环境。

你写 prompt，是在给模型一句话。

你写 loop，是在给 Agent 一套工作方式。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E5%85%AD%E3%80%81%E6%B2%A1%E6%9C%89%E9%AA%8C%E8%AF%81%E7%9A%84-ai-%E7%BC%96%E7%A8%8B-%E9%83%BD%E6%98%AF%E8%A1%A8%E9%9D%A2%E5%AE%8C%E6%88%90) 六、没有验证的 AI 编程，都是表面完成

AI 编程最容易骗过人的地方是什么？

不是代码写得差。

而是它很会“看起来完成了”。

它会给你一个很完整的解释。

会列出改了哪些文件。

会告诉你问题已经修复。

甚至还能把理由说得很顺。

但如果没有测试、构建、日志、人工验收这些反馈，它说“完成了”没有意义。

**AI 的完成感，不等于工程上的完成。**

![没有验证反馈的 AI 编程为什么容易表面完成图](https://file1.kamacoder.com/i/web/20260609100838_claude_code_loop_06_validation_failure_compressed.png)

真实项目里，我们判断一个改动能不能交付，不是看它解释得多漂亮。

而是看：

- 单测有没有过
- 构建有没有过
- 关键路径有没有回归
- 日志有没有异常
- 用户行为有没有变化
- 边界条件有没有覆盖

这些东西，就是 loop 的“眼睛”。

没有它们，Agent 只能靠语言自信。

语言自信是最不值钱的。

很多录友做 AI 项目，喜欢把重点放在 prompt 模板上。

我建议你换个角度：

**先问自己，这个任务有没有反馈信号。**

没有反馈信号，就不要轻易让 Agent 自动循环。

它不知道什么叫对。

不知道什么叫错。

那就只能越跑越玄学。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%B8%83%E3%80%81%E5%BC%80%E5%8F%91%E8%80%85%E4%B8%8D%E6%98%AF%E8%A2%AB%E6%9B%BF%E4%BB%A3%E4%BA%86-%E8%80%8C%E6%98%AF%E4%BD%8D%E7%BD%AE%E5%8F%98%E4%BA%86) 七、开发者不是被替代了，而是位置变了

看到“不写 prompt，写 loop”，有些人会紧张：

那是不是以后开发者不用写代码，只写规则？

没这么简单。

更准确地说，开发者的工作位置在变化。

以前你亲手写每一行代码。

后来你开始用 AI 生成代码，但你还要一直盯着它、提醒它、复制粘贴错误。

再往后，你要把这些反复提醒，沉淀成规则、测试、脚本、文档和权限边界。

也就是把“人盯人”变成“系统约束”。

![开发者从盯着 AI 到设计规则闭环的角色迁移图](https://file1.kamacoder.com/i/web/20260609100839_claude_code_loop_07_human_role_shift_compressed.png)

比如以前你会反复提醒：

“别改这个文件。”

现在你应该把它写进项目规则，或者用权限拦住。

以前你会反复说：

“改完跑测试。”

现在你应该让测试命令成为默认验证步骤。

以前你会在聊天里解释项目结构。

现在你应该把关键入口写进 `CLAUDE.md`。

以前你靠肉眼判断它有没有改对。

现在你要补测试、补脚本、补验收样例。

这不是开发者价值下降。

恰恰相反。

**越是 Agent 能干活，越需要懂工程的人来定义什么叫干对。**

不会写代码的人，很难写出好的 loop。

因为他不知道哪里危险，不知道哪里要验证，不知道什么改动会引发连锁问题。

所以别把 loop 理解成“AI 替我做所有事”。

它更像是：

**开发者把自己的工程判断，外化成 Agent 可以执行的闭环。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E5%85%AB%E3%80%81%E6%9C%AA%E6%9D%A5%E5%BC%80%E5%8F%91%E8%80%85%E5%88%B0%E5%BA%95%E8%A6%81%E5%86%99%E4%BB%80%E4%B9%88) 八、未来开发者到底要写什么？

如果说过去开发者主要写代码。

现在开发者开始写 prompt。

那再往后，开发者会越来越多地写这些东西：

- 任务目标
- 项目规则
- 测试用例
- 验收标准
- 工具接口
- 权限边界
- 错误恢复策略
- 监控和评估指标

这些东西合在一起，就是 loop 的骨架。

![AI Coding 时代人、Agent、模型、工具的新分工图](https://file1.kamacoder.com/i/web/20260609100841_claude_code_loop_08_new_division_compressed.png)

模型负责生成。

Agent 负责执行。

工具负责连接真实环境。

测试和日志负责反馈。

人负责目标、边界和最终判断。

这个分工如果看懂了，你就不会再纠结“提示词该怎么写得更神”。

你会开始关心：

**我的项目有没有足够清楚的规则？**

**我的任务有没有可验证的完成标准？**

**我的测试能不能给 Agent 稳定反馈？**

**我的工具返回值能不能让模型看懂？**

**我的权限边界会不会让 Agent 乱动生产资源？**

这些问题，才是 AI 编程真正开始工程化之后的核心问题。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E4%B9%9D%E3%80%81%E6%99%AE%E9%80%9A%E5%BC%80%E5%8F%91%E8%80%85%E6%80%8E%E4%B9%88%E5%BC%80%E5%A7%8B%E5%86%99-loop) 九、普通开发者怎么开始写 Loop？

如果你现在还只是偶尔让 AI 写点代码，不需要一下子搞很复杂。

从几个小动作开始就行。

**第一，别只写目标，要写验收。**

不要只说“修复登录问题”。

加一句：

“修完后跑登录模块测试，并说明失败用例是否恢复。”

**第二，别只让它改，要让它先定位。**

不要上来就说“直接改”。

先让它：

“先找登录入口、认证中间件和错误日志位置，列出可能原因，再改。”

**第三，给它边界。**

比如：

“不要修改数据库 schema。”

“不要改公开 API 返回结构。”

“不要调整鉴权策略，除非先说明风险。”

**第四，把反复说的话写进项目规则。**

如果你每次都提醒同一件事，就别再靠聊天提醒了。

写进 `CLAUDE.md`。

这就是从 prompt 走向 loop 的第一步。

**第五，优先补反馈信号。**

没有测试的项目，用 Agent 会很累。

不是不能用。

但你会一直靠人工判断。

一旦补了测试、lint、构建脚本，Agent 才有东西可以观察，loop 才跑得起来。

## [\#](https://notes.kamacoder.com/llm/claude/claude_code_loop.html\#%E5%8D%81%E3%80%81%E6%9C%80%E5%90%8E) 十、最后

Boris 这句话真正值得关注的地方，不是“不写 prompt”这四个字。

而是它提醒我们：

**AI 编程正在从对话技巧，进入工程闭环。**

Prompt 是入口。

Loop 是系统。

只会写 prompt，你最多让模型回答得更像你想要的样子。

会写 loop，你才能让 Agent 在真实项目里持续推进、自动验证、出错纠偏、边界内行动。

这就是差距。

以后 AI 编程里最值钱的能力，不是会不会喊 AI 干活。

而是你能不能把一个模糊任务，拆成一个可执行、可验证、可停止的闭环。

这才是工程能力。

←
[为什么Agent时代都在做CLI](https://notes.kamacoder.com/llm/claude/agent_cli.html)[Claude Code能力演进](https://notes.kamacoder.com/llm/claude/claude_code_extensions_evolution.html)
→


### 评论

登录后评论登录