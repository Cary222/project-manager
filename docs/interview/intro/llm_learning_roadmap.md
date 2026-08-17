---
source: https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html
category: intro
scraped_at: 2026-08-14T07:51:34.829Z
---

# [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%AD%A6%E4%B9%A0%E8%B7%AF%E7%BA%BF-%E7%A8%8B%E5%BA%8F%E5%91%98%E4%BB%8E%E9%9B%B6%E5%85%A5%E9%97%A8%E5%88%B0%E4%B8%8A%E6%89%8B%E9%A1%B9%E7%9B%AE-%E8%AF%A5%E6%8C%89%E4%BB%80%E4%B9%88%E9%A1%BA%E5%BA%8F%E5%AD%A6) 大模型学习路线：程序员从零入门到上手项目，该按什么顺序学

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-06-16·全文 2430 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

经常有录友问我同一个问题： **我是做后端的，想转大模型，到底该从哪学起？**

接着往往还有一连串：要不要先学 PyTorch？要不要先补数学？是不是得先看懂 Transformer 论文？微调是不是必须会？

我先把结论说在前面： **这些大概率都不是你的第一步。**

做大模型"应用"开发，和做"算法/训练"是两条路。你要补的不是数学，而是一条从"会调一次大模型"到"能搭一套能上线的系统"的完整链路。这篇就把这条路线讲清楚—— **每一步学什么、为什么先学它、哪些要深挖、哪些点到为止就行。**

如果你还没搞清楚自己要走哪条路，建议先看这两篇打底： [大模型应用开发、算法岗、开发岗到底什么区别](https://notes.kamacoder.com/llm/intro/application_development.html) 和 [大模型应用开发到底在做什么](https://notes.kamacoder.com/llm/intro/app_dev_overview.html)。想清楚定位，再开始走路线，不然容易学偏。

先把整条路线放出来，下面每一步都对着这张图讲：

![大模型学习路线：程序员从零入门的七个阶段](https://file1.kamacoder.com/i/web/20260616160116_llmroadmap.png)

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E5%85%88%E8%AF%B4%E4%B8%80%E4%B8%AA%E6%9C%80%E5%B8%B8%E8%A7%81%E7%9A%84%E8%AF%AF%E5%8C%BA) 先说一个最常见的误区

很多人一上来就扎进 Transformer 推导、注意力公式、反向传播，啃了两周，啃不动，劝退了。

**顺序反了。**

你现在用的大模型，是别人已经训练好的。你要做的是"用它 \+ 接业务 \+ 上工程"，而不是"造它"。所以正确的顺序是 **先应用、后原理**：先把它当黑盒用起来、用顺手，建立起整套链路的直觉，再回头拆开看里面是什么。等你做过 RAG、踩过 Agent 的坑，再去看 Transformer，会发现"哦原来那个东西是为了解决我遇到的问题"——这时候才学得进去。

所以下面这条路线，是按 **依赖关系** 排的：前一步是后一步的地基，缺了走不动。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E4%B8%80%E9%98%B6%E6%AE%B5-%E5%85%A5%E9%97%A8%E8%AE%A4%E7%9F%A5-%E5%85%88%E6%8A%8A%E5%9C%B0%E5%9B%BE%E7%9C%8B%E6%B8%85%E6%A5%9A) 第一阶段：入门认知——先把地图看清楚

目标：花最短的时间，搞清楚大模型这个领域有哪些概念、它们之间什么关系、你要做的岗位在整张地图的哪个位置。

这一步 **不要写代码**，就是建立认知框架。最怕的是术语满天飞——Prompt、Token、RAG、Agent、MCP、微调、Embedding——每个单独搜都能搜到，但串不起来。

建议从这篇开始，它把核心概念串成一条进化线： [大模型关键词全解：从 Prompt 到 Agent 到 MCP，一篇搞懂 13 个核心概念](https://notes.kamacoder.com/llm/intro/llm_keywords.html)。

然后补几块认知拼图：

- [大模型到底是怎么训练出来的](https://notes.kamacoder.com/llm/intro/how_llm_trained.html)——知道它是怎么来的，才理解它为什么会幻觉
- [大模型 API 到底怎么计费](https://notes.kamacoder.com/llm/intro/llm_pricing.html)——这是你以后天天要算的账
- [大模型蒸馏到底是什么](https://notes.kamacoder.com/llm/intro/model_distillation.html)——理解小模型、降本是怎么回事

这一阶段不用久， **一周以内**，目的是不再"听不懂别人在说什么"。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E4%BA%8C%E9%98%B6%E6%AE%B5-prompt-%E4%B8%8E%E8%B0%83%E7%94%A8%E5%9F%BA%E7%A1%80-%E4%BB%8E-%E4%BC%9A%E8%81%8A%E5%A4%A9-%E5%88%B0-%E4%BC%9A%E5%BC%80%E5%8F%91) 第二阶段：Prompt 与调用基础——从"会聊天"到"会开发"

目标：能用代码把一次大模型调用接进你的程序，并且让它 **稳定地** 输出你要的格式。

很多人以为调大模型就是发一句话拿一句话，真做起来才发现：输出格式不稳定、要流式返回、要让它调工具……这些才是应用开发的日常。

按这个顺序走：

- [从聊天框到业务系统：一个请求是怎么被大模型处理的](https://notes.kamacoder.com/llm/app/model_integration.html)
- [结构化输出：JSON Schema 怎么约束](https://notes.kamacoder.com/llm/app/structured_output.html)——业务系统离不开稳定的结构化输出
- [同步、异步、流式输出怎么选](https://notes.kamacoder.com/llm/app/streaming_output.html)
- [Function Calling 详解：大模型怎么调用工具](https://notes.kamacoder.com/llm/app/function_calling.html)——这是后面 Agent 的地基

学完这一阶段，你已经能写出一个"接了大模型、能调工具、输出可控"的小程序了。这是从读者变成开发者的分水岭。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E4%B8%89%E9%98%B6%E6%AE%B5-rag-%E6%A3%80%E7%B4%A2%E5%A2%9E%E5%BC%BA-%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%BA%94%E7%94%A8%E7%9A%84%E7%AC%AC%E4%B8%80%E4%B8%AA%E7%A1%AC%E9%AA%A8%E5%A4%B4) 第三阶段：RAG 检索增强——大模型应用的第一个硬骨头

目标：能独立设计一套 RAG 系统，知道它每一环在干什么、出了问题怎么定位。

为什么 RAG 排在 Agent 前面？因为它是企业里 **落地最多、面试问得最狠** 的方向，而且它把"检索 \+ 拼上下文 \+ 生成"这条链路讲透了，是理解后面一切的基础。

先搞清楚为什么需要它，再一环一环拆：

- [为什么有了大模型还需要 RAG](https://notes.kamacoder.com/llm/app/why_rag.html)
- [RAG 完整链路拆解：离线阶段和在线阶段](https://notes.kamacoder.com/llm/app/chain_of_rag.html)
- [Embedding 是什么：语义压缩与模型选型](https://notes.kamacoder.com/llm/app/embedding.html)
- [向量数据库解决了什么问题](https://notes.kamacoder.com/llm/app/vector_database.html)
- [RAG 切片策略：四种方式对比](https://notes.kamacoder.com/llm/app/how_to_chunking.html)
- [RAG 系统答不准的常见问题排查](https://notes.kamacoder.com/llm/app/rag_problems.html)
- [RAG 优化思路：Query 改写到 Context 压缩](https://notes.kamacoder.com/llm/app/rag_optimization.html)

这一阶段是重头戏， **别赶进度**。RAG 答不准的排查能力，是面试里最能拉开差距的地方。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E5%9B%9B%E9%98%B6%E6%AE%B5-agent-%E6%99%BA%E8%83%BD%E4%BD%93-%E4%BB%8E-%E7%AD%94%E4%B8%80%E5%8F%A5-%E5%88%B0-%E8%87%AA%E5%B7%B1%E5%B9%B2%E5%AE%8C%E4%B8%80%E4%BB%B6%E4%BA%8B) 第四阶段：Agent 智能体——从"答一句"到"自己干完一件事"

目标：理解 Agent 的设计思路，知道什么时候该上 Agent、什么时候根本不需要，以及它为什么容易翻车。

有了第二阶段的 Function Calling 和第三阶段的 RAG，Agent 才学得动——因为 Agent 本质就是"会调工具 + 会用记忆 + 会自己决定下一步"。

如果你就是冲着 Agent 来的，这一阶段我单独拆了一篇更细的 [AI Agent 学习路线](https://notes.kamacoder.com/llm/app/agent_learning_roadmap.html)，把下面这些文章该按什么顺序学讲透了，建议照那篇走。

- [Agent 到底是什么？和普通大模型问答有什么区别](https://notes.kamacoder.com/llm/app/agent_intro.html)
- [ReAct、Reflection、规划执行：三种常见思路怎么选](https://notes.kamacoder.com/llm/app/react_reflection_planning.html)
- [Agent vs Workflow：什么时候根本不需要 Agent](https://notes.kamacoder.com/llm/app/agent_vs_workflow.html)——这一篇能帮你少踩很多"过度 Agent 化"的坑
- [工具设计决定 Agent 上限](https://notes.kamacoder.com/llm/app/agent_tool_design.html)
- [MCP 协议详解：和 Function Calling 有什么区别](https://notes.kamacoder.com/llm/app/mcp_protocol.html)
- [Agent 为什么容易翻车](https://notes.kamacoder.com/llm/app/agent_failure_modes.html)
- [Agent 的记忆：短期、长期、RAG 到底什么关系](https://notes.kamacoder.com/llm/app/agent_memory.html)
- [Agent 怎么评估：任务完成率与可靠性度量](https://notes.kamacoder.com/llm/app/agent_evaluation.html)

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E4%BA%94%E9%98%B6%E6%AE%B5-%E5%BE%AE%E8%B0%83%E9%80%89%E5%9E%8B-%E4%B8%8D%E4%BA%B2%E6%89%8B%E8%AE%AD-%E4%BD%86%E8%A6%81%E6%87%82%E8%BE%B9%E7%95%8C) 第五阶段：微调选型——不亲手训，但要懂边界

目标：知道什么场景该微调、什么场景 RAG 就够了，能在面试里把 SFT、LoRA、RLHF 的区别和适用边界讲清楚。

注意这里的关键词是\*\*"认知"\*\*，不是"亲手训一个"。对应用开发者来说，绝大多数问题用 Prompt + RAG 就解决了，微调是最后才考虑的手段。但面试必问，所以你得懂选型边界：什么时候微调、用哪种微调、要多少数据、成本多大。

- [SFT、RLHF、DPO：微调方法全景认知](https://notes.kamacoder.com/llm/app/finetuning_sft_rlhf_dpo.html)
- [LoRA / QLoRA：为什么低秩微调这么流行](https://notes.kamacoder.com/llm/app/lora_qlora.html)

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E5%85%AD%E9%98%B6%E6%AE%B5-%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%B7%A5%E7%A8%8B%E5%8C%96-%E6%8A%8A-demo-%E5%8F%98%E6%88%90%E8%83%BD%E6%89%9B%E6%B5%81%E9%87%8F%E7%9A%84%E7%B3%BB%E7%BB%9F) 第六阶段：部署与工程化——把 Demo 变成能扛流量的系统

目标：理解一套大模型服务上线后要关注哪些指标，高峰期卡顿、响应忽快忽慢该往哪查。

这是应用开发者真正的护城河。很多人 Demo 做得漂亮，一问部署、压测、扩容就哑火。面试官也最爱从这里往深里钻。

- [大模型部署、推理、压测核心指标：TPS、首字延迟、吞吐、并发](https://notes.kamacoder.com/llm/app/stress_testing.html)

为什么大模型系统特别关注"首字延迟"？vLLM 又优化了什么？这些都是工程化的入门必答题。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E7%AC%AC%E4%B8%83%E9%98%B6%E6%AE%B5-transformer-%E5%8E%9F%E7%90%86-%E5%9B%9E%E5%A4%B4%E6%8B%86%E5%BC%80%E9%BB%91%E7%9B%92) 第七阶段：Transformer 原理——回头拆开黑盒

目标：从应用开发者的视角理解大模型内部结构，面试被问到能讲清楚，手撕代码不慌。

走到这里你才回来看原理，而且会发现轻松多了——因为前面每一个概念你都用过，现在只是把它们对应到内部结构上。

先理解结构：

- [为什么都绕不开 Transformer](https://notes.kamacoder.com/llm/transformer/transformer_base_1.html)
- [Attention 机制：Q、K、V 是什么](https://notes.kamacoder.com/llm/transformer/qkv.html)
- [Multi-Head Attention：为什么一个头不够](https://notes.kamacoder.com/llm/transformer/mha.html)
- [位置编码：Transformer 为什么必须知道顺序](https://notes.kamacoder.com/llm/transformer/pos_encode.html)

再手撕代码，面试有底气：

- [手撕 Attention：不依赖框架从零实现](https://notes.kamacoder.com/llm/transformer/attention_code.html)
- [手撕 Tiny Transformer：从零拼出完整模型](https://notes.kamacoder.com/llm/transformer/tiny_transformer_code.html)

完整的 Transformer 原理篇和手撕篇，都在 [卡码大模型专栏首页](https://notes.kamacoder.com/llm/) 按章节列好了，照着顺序走即可。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E8%BF%99%E6%9D%A1%E8%B7%AF%E7%BA%BF%E8%A6%81%E8%B5%B0%E5%A4%9A%E4%B9%85) 这条路线要走多久

不骗你， **没有"21 天速成"**。但也没那么吓人。

如果你已经是有经验的后端，每天能挤出一两个小时，第一到第四阶段（入门、调用、RAG、Agent）大致一到两个月能走完，这时候你已经能独立做出一个像样的大模型应用项目，也能应付大部分应用开发岗的面试。后面三个阶段（微调认知、部署、Transformer）是边做项目边补，越往后越是"用到再深挖"。

关键不是快，是 **顺序别乱、每一步落到手上有产出**：学完调用就写个小工具，学完 RAG 就搭个知识库，学完 Agent 就做个能自己干活的小助手。简历上的项目，就是这么一篇一篇攒出来的。

## [\#](https://notes.kamacoder.com/llm/intro/llm_learning_roadmap.html\#%E4%B8%80%E8%BE%B9%E5%AD%A6%E4%B8%80%E8%BE%B9%E5%87%86%E5%A4%87%E6%B1%82%E8%81%8C) 一边学一边准备求职

学到能做项目，下一步就是把它变成简历和面试里的筹码。

大模型相关的面试题，我整理在了 [大模型面经](https://notes.kamacoder.com/interview/llm/) 里；简历怎么写，可以看 [简历专栏](https://notes.kamacoder.com/jianli/)。学和找工作不要分两段， **边学边按四要素把项目写进简历**，效率最高。

我也在 [知识星球(opens new window)](https://mp.weixin.qq.com/s/lLq0U6momirYMwzqyQ5KXg) 里辅导过很多录友转大模型，路线、项目、面试一路盯着改，少走弯路。

照着这条路线走，一步一步来，你会发现大模型没那么玄。

←
[Claude Code从入门到工程实践](https://notes.kamacoder.com/llm/claude/)[大模型关键词全解](https://notes.kamacoder.com/llm/intro/llm_keywords.html)
→


### 评论

登录后评论登录