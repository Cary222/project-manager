---
source: https://notes.kamacoder.com/llm/transformer/mha.html
category: transformer
scraped_at: 2026-08-14T07:53:27.134Z
---

# [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#multi-head-attention%E8%AF%A6%E8%A7%A3-%E4%B8%BA%E4%BB%80%E4%B9%88%E4%B8%80%E4%B8%AA%E5%A4%B4%E4%B8%8D%E5%A4%9F-%E5%A4%9A%E5%A4%B4%E6%80%8E%E4%B9%88%E6%8B%86%E5%88%86%E5%92%8C%E6%8B%BC%E6%8E%A5) Multi-Head Attention详解：为什么一个头不够，多头怎么拆分和拼接

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-05-25·全文 1098 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

上一篇文章我们把 Attention 的计算过程完整走了一遍，从 QKᵀ 到 Softmax 再到加权求和。
这篇文章我们来聊聊： **为什么 Transformer 不只用一个 Attention，而是要用"多个头"？**

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E4%B8%80%E4%B8%AA%E5%A4%B4%E6%9C%89%E4%BB%80%E4%B9%88%E9%97%AE%E9%A2%98) 一个头有什么问题？

先看这句话：

> 我用筷子吃了一碗热腾腾的麻辣烫，它真的很好吃

这里的"它"指的是什么？麻辣烫。

但如果我问你，模型在理解这句话时，需要同时搞清楚哪些关系？

- "它" → "麻辣烫"（指代关系）
- "热腾腾""麻辣烫"（修饰关系）
- "筷子" → "吃"（工具与动作的关系）
- "我" → "吃"（主语与动作的关系）

这些关系是 **同时存在** 的，但性质完全不同。

而单头 Attention 每次只能输出一个注意力权重矩阵，相当于 **从一个角度** 去看整句话的关系。很难指望它同时把"指代""修饰""语法"这些完全不同的信息都捕捉到。

> 一个头，就像只用一种颜色的笔去批注一篇文章——你只能标出一种重点。

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E5%A4%9A%E5%A4%B4%E7%9A%84%E6%A0%B8%E5%BF%83%E6%80%9D%E8%B7%AF-%E8%AE%A9%E4%B8%8D%E5%90%8C%E7%9A%84%E5%A4%B4%E5%85%B3%E6%B3%A8%E4%B8%8D%E5%90%8C%E7%9A%84%E5%85%B3%E7%B3%BB) 多头的核心思路：让不同的头关注不同的关系

Multi-Head Attention 的思路很直接：

**与其让一个 Attention 面面俱到，不如让多个 Attention 各司其职。**

每个"头"（Head）都有自己独立的 W\_Q、W\_K、W\_V 权重矩阵，经过训练后，不同的头自然会学到不同类型的关注模式：

- 有的头专门捕捉 **短距离的语法依赖**（比如"主谓宾"）
- 有的头专门处理 **指代关系**（"它"指向谁）
- 有的头关注 **位置信息**（相邻词之间的关系）

这些头并行运算，最后把结果拼在一起，就能让模型同时"从多个角度"理解这句话。

![单头注意力关注关系示意图](https://file1.kamacoder.com/i/algo/173c684a-4950-420e-a41e-d27aa8617fa4.webp)

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E7%BB%B4%E5%BA%A6%E6%98%AF%E6%80%8E%E4%B9%88%E6%8B%86%E5%88%86%E7%9A%84) 维度是怎么拆分的？

这是很多初学者第一次看到多头时会懵的地方： **多头 Attention 会不会让计算量变成原来的 h 倍？**

答案是： **不会**。秘密在于"维度拆分"。

以 d\_model = 512、h = 8 个头为例：

单头 Attention 中，Q、K、V 都是 512 维。
多头 Attention 里，每个头只用 **512 ÷ 8 = 64 维**。

也就是说，不是"用 8 个完整的 Attention 再加起来"，而是 **把 512 维切成 8 份，每个头负责其中一份**：

```text
原始 Q（n × 512）→ 切分成 8 个 Q_i（n × 64）
原始 K（n × 512）→ 切分成 8 个 K_i（n × 64）
原始 V（n × 512）→ 切分成 8 个 V_i（n × 64）
```

1

2

3

每个头在自己的 64 维子空间里做完整的 Attention 计算，输出也是 n × 64。

**总计算量和单头基本持平**，但同时"看"了 8 个不同的子空间。

![多头注意力从多个角度观察Token关系示意图](https://file1.kamacoder.com/i/algo/5678999c-0469-46eb-bfa7-dced9c8ce9c0.webp)

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E6%9C%80%E5%90%8E%E4%B8%80%E6%AD%A5-%E6%8B%BC%E6%8E%A5-%E7%BA%BF%E6%80%A7%E5%8F%98%E6%8D%A2) 最后一步：拼接 \+ 线性变换

8 个头各自算完，得到 8 个 n × 64 的输出矩阵。
把它们 **横向拼接**，就还原成 n × 512：

```text
[head₁ | head₂ | ... | head₈]  →  n × 512
```

1

但拼接之后还没完——还要再乘一个 WOW\_OWO​（512×512）的输出投影矩阵，做一次线性变换：

MultiHead(Q,K,V)=Concat(head1,...,headh)⋅WO\\text{MultiHead}(Q,K,V) = \\text{Concat}(\\text{head}\_1, ..., \\text{head}\_h) \\cdot W^O
MultiHead(Q,K,V)=Concat(head1​,...,headh​)⋅WO

为什么还要乘 WOW\_OWO​？因为 8 个头各自在自己的子空间里理解信息，拼在一起之后，需要 WOW\_OWO​ 把这些信息 **重新整合、混合**，让不同头学到的东西互相"对话"，输出一个统一的表示。

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E6%95%B4%E4%BD%93%E6%B5%81%E7%A8%8B%E4%B8%80%E7%9C%BC%E7%9C%8B%E6%B8%85) 整体流程一眼看清

| 步骤 | 操作 | 输入 | 输出 |
| --- | --- | --- | --- |
| ① 线性投影 | 乘 WQ,WK,WVW\_Q, W\_K, W\_VWQ​,WK​,WV​ | n × 512 | n × 512（每个） |
| ② 维度拆分 | 切成 h 份 | n × 512 | h 个 n × 64 |
| ③ 并行 Attention | 每个头独立计算 | n × 64 | h 个 n × 64 |
| ④ 拼接 | Concat | h 个 n × 64 | n × 512 |
| ⑤ 输出投影 | 乘 WOW\_OWO​ | n × 512 | n × 512 |

输入是 n × 512，输出还是 n × 512， **维度没有变化**，但每个 Token 的向量里已经融合了来自多个视角的上下文信息。

* * *

## [\#](https://notes.kamacoder.com/llm/transformer/mha.html\#%E5%B0%8F%E7%BB%93) 小结

多头 Attention 解决的核心问题，就是 **一个 Attention 头"视角太单一"**。
通过维度拆分，让多个头并行、各自在低维子空间里学习不同的关注模式，最后拼接融合，在 **不增加计算量** 的前提下，大幅提升了模型捕捉复杂语言关系的能力。

下一篇文章我们来聊聊 \*\*Positional Encoding \*\*，看看为什么 Transformer中必须知道顺序 ，大家点个关注不迷路～

阅读更多


←
[Attention计算全过程一步步拆解](https://notes.kamacoder.com/llm/transformer/qkv_cal.html)[位置编码：Transformer为什么必须知道顺序](https://notes.kamacoder.com/llm/transformer/pos_encode.html)
→


### 评论

登录后评论登录