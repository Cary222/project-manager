---
source: https://notes.kamacoder.com/llm/transformer/pos_encode.html
category: transformer
scraped_at: 2026-08-14T07:53:50.652Z
---

# [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81%E8%AF%A6%E8%A7%A3-transformer%E4%B8%BA%E4%BB%80%E4%B9%88%E5%BF%85%E9%A1%BB%E7%9F%A5%E9%81%93token%E9%A1%BA%E5%BA%8F-%E6%AD%A3%E5%BC%A6%E7%BC%96%E7%A0%81%E5%8E%9F%E7%90%86) 位置编码详解：Transformer为什么必须知道Token顺序，正弦编码原理

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-05-25·全文 1289 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

上一篇文章我们搞清楚了 Multi-Head Attention 的运作方式——多个头并行、各自关注不同关系，最后融合输出。
这篇文章我们来聊一个经常被忽略、但非常关键的问题： **Positional Encoding 是什么？ Transformer 是怎么知道词的顺序的？**

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E5%85%88%E5%81%9A%E4%B8%80%E4%B8%AA%E5%AE%9E%E9%AA%8C) 先做一个实验

看下面这两句话：

> 我打了他

> 他打了我

意思完全相反，但用的是 **完全一样的词**，唯一的区别是 **顺序不同**。

一个好的语言模型，必须能区分这两句话。那 Transformer 能吗？

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E8%87%AA%E6%B3%A8%E6%84%8F%E5%8A%9B%E5%A4%A9%E7%84%B6%E4%B8%8D%E6%84%9F%E7%9F%A5%E9%A1%BA%E5%BA%8F) 自注意力天然不感知顺序

这是 Transformer 一个反直觉的地方。

回忆一下 Self-Attention 的计算：每个 Token 和 **所有其他 Token** 做内积，算出注意力权重，再加权求和。

在这个过程里， **Token 的位置信息从来没有参与过计算**。
"我"在第一位还是第三位，对 QKᵀ 的结果没有任何影响。

用一句话来说：

> Self-Attention 眼里只有"有哪些词"，没有"这些词在哪里"

你把输入序列的词顺序随机打乱，Self-Attention 算出来的注意力权重 **完全一样**。

这就意味着，如果什么都不做，"我打了他"和"他打了我"在 Transformer 看来是 **同一句话**。

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E4%B8%BA%E4%BB%80%E4%B9%88-rnn-%E4%B8%8D%E9%9C%80%E8%A6%81%E6%8B%85%E5%BF%83%E8%BF%99%E4%B8%AA%E9%97%AE%E9%A2%98) 为什么 RNN 不需要担心这个问题？

你可能会想：RNN 不也是处理序列的吗，它有这个问题吗？

没有。RNN 是 **一个词一个词按顺序处理** 的，天然把位置信息编进了隐藏状态里。第一个词处理完，才轮到第二个词，顺序是硬编码在结构里的。

而 Transformer 的优势之一，恰恰是 **可以并行处理所有词**——所有 Token 同时进入 Self-Attention。但代价就是： **顺序信息丢了**，需要手动补回来。

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88-%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81) 解决方案：位置编码

解决思路很简单：既然 Self-Attention 本身不感知位置，那就 **在输入进 Attention 之前，把位置信息加进去**。

具体做法是：给每个 Token 的 Embedding 向量，加上一个代表它位置的向量，这个向量就叫 **Positional Encoding（位置编码）**。

输入=Token Embedding+Positional Encoding\\text{输入} = \\text{Token Embedding} + \\text{Positional Encoding}
输入=Token Embedding+Positional Encoding

加完之后，每个 Token 的向量里就同时包含了 **语义信息**（它是什么词）和 **位置信息**（它在第几位）。

![Transformer没有位置编码时无法区分词序示意图](https://file1.kamacoder.com/i/algo/589ad6d1-bb1a-4faa-8260-d923a2f410a9.webp)

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81%E9%95%BF%E4%BB%80%E4%B9%88%E6%A0%B7) 位置编码长什么样？

原始论文用的是 **正弦和余弦函数** 来生成位置编码，公式如下：

PE(pos,2i)=sin⁡(pos100002i/d)PE\_{(pos,\ 2i)} = \\sin\\left(\\frac{pos}{10000^{2i/d}}\\right)
PE(pos,2i)​=sin(100002i/dpos​)

PE(pos,2i+1)=cos⁡(pos100002i/d)PE\_{(pos,\ 2i+1)} = \\cos\\left(\\frac{pos}{10000^{2i/d}}\\right)
PE(pos,2i+1)​=cos(100002i/dpos​)

我们一步步来看这两个公式。

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#_1-%E4%B8%BA%E4%BB%80%E4%B9%88%E7%94%A8%E4%B8%89%E8%A7%92%E5%87%BD%E6%95%B0) 1.为什么用三角函数？

位置编码需要满足几个条件：

1. **每个位置的编码唯一**，不能有两个位置一模一样
2. **位置之间的"距离"有规律**，相邻位置的编码应该相似，距离越远越不同
3. **可以泛化到更长的序列**，训练时没见过的位置也能用

正弦和余弦函数天然满足这几点：不同频率的波形叠加，就像一把"尺子"，每个刻度的花纹都不一样，但整体有规律。

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#_2-%E4%B8%BA%E4%BB%80%E4%B9%88%E4%B8%8D%E5%90%8C%E7%BB%B4%E5%BA%A6%E7%94%A8%E4%B8%8D%E5%90%8C%E9%A2%91%E7%8E%87) 2.为什么不同维度用不同频率？

位置编码是一个和 Token Embedding 等长的向量，比如 512 维。

正弦编码的聪明之处在于： **不同维度使用不同频率的波**。

- 低维度：频率高，变化快 → 区分近距离的位置（第1个词 vs 第2个词）
- 高维度：频率低，变化慢 → 区分远距离的位置（第1个词 vs 第100个词）

就好像用"秒"刻度区分相邻时刻，用"小时"刻度区分跨度更大的时间段—— **不同精度的尺子，量不同尺度的距离**。

![正弦位置编码不同频率变化示意图](https://file1.kamacoder.com/i/algo/ddc658ca-f85f-4cca-b5fb-b4e9bf059e5c.webp)

## [\#](https://notes.kamacoder.com/llm/transformer/pos_encode.html\#_3-%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81%E6%98%AF%E5%9B%BA%E5%AE%9A%E7%9A%84-%E8%BF%98%E6%98%AF%E5%AD%A6%E5%87%BA%E6%9D%A5%E7%9A%84) 3.位置编码是固定的，还是学出来的？

原始 Transformer 论文用的是 **固定的正弦编码**，不参与训练，直接按公式算好。

但后来很多模型（比如 BERT）用的是 **可学习的位置编码**——位置编码也是一组参数，和词向量一起随训练更新。

两种方式在实践中效果相差不大，但各有侧重：

|  | 正弦编码（固定） | 可学习编码 |
| --- | --- | --- |
| **参数量** | 无额外参数 | 多一组位置参数 |
| **长序列泛化** | 理论上可以外推 | 受训练长度限制 |
| **代表模型** | 原始 Transformer | BERT、GPT-2 |

Transformer 用 Self-Attention 并行处理所有词，带来了速度优势，但也丢掉了顺序信息。位置编码就是用来"补"回这个信息的——在输入进 Attention 之前，把每个 Token 的位置"写"进它的向量里。

正弦位置编码的设计看起来复杂，本质上是一把多精度的尺子：不同维度、不同频率，共同唯一标识每个位置，还能泛化到更长的序列。

* * *

下一篇文章我们来聊聊 **残差连接与 Layer Norm**，看看 Transformer 是怎么防止信息在层层传递中"消失"的，大家可以点个关注不迷路～

阅读更多


←
[Multi-Head Attention：为什么一个头不够](https://notes.kamacoder.com/llm/transformer/mha.html)[残差连接、LayerNorm、FFN：缺一不可的配角](https://notes.kamacoder.com/llm/transformer/ffn_ln.html)
→


### 评论

登录后评论登录