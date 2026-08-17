---
source: https://notes.kamacoder.com/llm/transformer/qkv.html
category: transformer
scraped_at: 2026-08-14T07:54:02.355Z
---

# [\#](https://notes.kamacoder.com/llm/transformer/qkv.html\#attention%E6%9C%BA%E5%88%B6%E8%AF%A6%E8%A7%A3-q%E3%80%81k%E3%80%81v%E6%98%AF%E4%BB%80%E4%B9%88-%E4%B8%BA%E4%BB%80%E4%B9%88%E5%AE%83%E6%98%AFtransformer%E7%9A%84%E6%A0%B8%E5%BF%83) Attention机制详解：Q、K、V是什么，为什么它是Transformer的核心

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-05-25·全文 696 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

上一阶段给大家接受了Transformer的基础原理， 接下来的几篇文章将重点给大家拆解Transformer的几个核心组件与计算原理。本篇文章先给大家介绍一下Attention机制当作过渡。

## [\#](https://notes.kamacoder.com/llm/transformer/qkv.html\#%E6%B3%A8%E6%84%8F%E5%8A%9B%E7%9A%84%E7%9B%B4%E8%A7%89%E8%A7%A3%E9%87%8A) 注意力的直觉解释

Attention本质上在做一件很像人类的事，大家先看这句话：

> 小明打了小刚，因为他生气了

这里的“他”指的是谁？小明？小刚？放你看到这句话时，你不会随机回答，你会“先看一眼上下文”，再做出判断——小明。这就是Attention的直觉解释：

> 从上下文中，挑出和当前词最相关的部分；也就是说， **每个Token都会关注其他Token，但关注的程度不一样**

## [\#](https://notes.kamacoder.com/llm/transformer/qkv.html\#%E4%B8%BA%E4%BB%80%E4%B9%88%E5%BF%85%E9%A1%BB%E5%85%B3%E6%B3%A8%E4%B8%8D%E5%90%8Ctoken) 为什么必须关注不同Token？

如果没有Attention机制，会发生什么？

1.每个词独立处理

2.像RNN一样顺序传递信息

这都会导致远距离的信息丢失，比如这句话：

> 我最近都在学习Transformer，前几天还去图书馆借了相关书籍，今天终于把Transformer学完了，它真的很强大

“它”指的是谁？相关书籍？图书馆？Transformer？如果模型不能\*\*“看整体”\*\*，就很难捕捉到这样的语义信息

## [\#](https://notes.kamacoder.com/llm/transformer/qkv.html\#query-key-value%E5%9C%A8attention%E4%B8%AD%E6%89%AE%E6%BC%94%E7%9A%84%E8%A7%92%E8%89%B2) Query，Key，Value在Attention中扮演的角色

大家一定也会常常听到Attention中的QKV矩阵，也是很多人搞不懂的地方： **QKV到底是做什么的？** 本篇文章依旧不涉及复杂公式，给大家形象介绍下它们的用途。

Query（Q）：当前Token会问所有Token一个问题：我应该\*\*“更注意”\*\* 谁？

比如这句话：

> _远方走来的是一位身穿白裙婀娜多姿面带微笑的少女_

这句话中，“身穿白裙”“婀娜多姿”“面带微笑”“少”等词对于“女”的语义影响是很大的，而“的”“是”等词就显得没有那么重要，于是Query矩阵就相当于“女”这个Token在发问： **我应该更关注谁？**

![Query Key Value角色关系示意图](https://file1.kamacoder.com/i/algo/a5d4c76f-01d3-4755-b481-cb8cfdc1a5ad.webp)

Key（K）：这个矩阵相当于在回答Query矩阵的问题，还是以上面这句话为例，“女”这个Token会问：我应该更关注谁？而Key矩阵则是回答：你应该更关注我。于是“身穿白裙”“婀娜多姿”“面带微笑”“少”则是回答“女”的query： **多关注我！**

![Attention根据QK相似度聚合Value示意图](https://file1.kamacoder.com/i/algo/42a2c5fd-ca0a-41ba-b101-7fe9679cd5b8.webp)

Value（V）：Value 是 Token 携带的 **核心特征信息**。当 Query 发现某个 Key 很匹配时，它就会把对应的 Value 提取出来，融入到当前的语义表示中

下一篇文章将会给大家讲解Q，K，V与softmax的计算细节，点个关注不迷路～

阅读更多


←
[三种架构详解与对比](https://notes.kamacoder.com/llm/transformer/transformer_base_encoder_decoder.html)[Attention计算全过程一步步拆解](https://notes.kamacoder.com/llm/transformer/qkv_cal.html)
→


### 评论

登录后评论登录