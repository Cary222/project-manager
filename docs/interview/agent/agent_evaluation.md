---
source: https://notes.kamacoder.com/llm/app/agent_evaluation.html
category: agent
scraped_at: 2026-08-14T07:46:25.606Z
---

# [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#agent%E6%80%8E%E4%B9%88%E8%AF%84%E4%BC%B0-%E4%BB%BB%E5%8A%A1%E5%AE%8C%E6%88%90%E7%8E%87%E4%B8%8E%E5%8F%AF%E9%9D%A0%E6%80%A7%E5%BA%A6%E9%87%8F) Agent怎么评估？任务完成率与可靠性度量

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-06-16·全文 5759 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

[![KamaClaude](https://file1.kamacoder.com/i/web/2026-06-16_14-36-54.jpg)](https://programmercarl.com/other/project_kamaClaude.html)

上一篇我们讲了 [Agent 的记忆](https://notes.kamacoder.com/llm/app/agent_memory.html)。

短期记忆、Session State、长期记忆、RAG，不是几个时髦名词。

它们本质上都在解决一个问题：

**Agent 执行任务时，怎么知道自己在做什么、做到了哪一步、哪些信息还能用。**

但只会设计记忆，还不够。

因为你设计完以后，还要回答一个更现实的问题：

**这个 Agent 到底好不好用？**

很多录友做 Agent 项目，最容易犯的错就是：

“我试了几个问题，感觉还可以。”

这不叫评估。

这叫碰运气。

Agent 和普通问答不一样。

普通问答可以主要看最终答案对不对。

Agent 不行。

因为 Agent 中间会规划、会调用工具、会读工具结果、会改策略、会做多步动作。

它最后答对了，也可能是中间乱调用工具碰巧答对。

它最后答错了，也可能是工具返回失败、权限不足、缺少关键输入，不一定全是模型问题。

所以先记住一句话：

**Agent 评估不能只看最终答案，要看整个执行过程。**

这篇我们就把 Agent 怎么评估讲清楚。

![Agent评估需要同时查看最终答案、执行轨迹和安全边界](https://file1.kamacoder.com/i/web/20260528163456_agent_evaluation_01_eval_layers_compressed.png)

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%B8%80%E3%80%81%E4%B8%BA%E4%BB%80%E4%B9%88-agent-%E8%AF%84%E4%BC%B0%E6%AF%94%E6%99%AE%E9%80%9A%E9%97%AE%E7%AD%94%E9%9A%BE) 一、为什么 Agent 评估比普通问答难

普通大模型问答的评估，通常是这样：

用户问一个问题。

模型给一个答案。

然后看答案是否正确、是否完整、是否符合格式。

但 Agent 多了很多中间环节。

比如用户说：

“帮我分析这个仓库为什么启动慢，并给优化建议。”

Agent 可能要：

1. 读取项目目录。
2. 找启动入口。
3. 查看配置文件。
4. 搜索初始化逻辑。
5. 查慢日志。
6. 总结可能原因。
7. 给出优化优先级。

这里面每一步都可能出问题。

它可能目录读错。

它可能搜错关键词。

它可能把测试配置当成生产配置。

它可能工具失败后继续硬编。

它可能只看了一个模块，就开始总结全局问题。

所以 Agent 评估至少要回答四个问题：

**第一，最终任务完成了吗？**

也就是用户目标有没有达成。

**第二，中间过程靠谱吗？**

有没有乱调用工具、重复调用、越权调用、忽略失败。

**第三，成本和效率怎么样？**

同样的任务，是 5 步完成，还是绕了 30 步。

**第四，失败时能不能收住？**

缺参数、工具超时、权限不足时，是追问和停止，还是继续瞎猜。

这就是为什么 Agent 评估不能只看“答案像不像”。

**要看结果，也要看轨迹。**

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%BA%8C%E3%80%81agent-%E8%AF%84%E4%BC%B0%E7%9A%84%E7%AC%AC%E4%B8%80%E6%8C%87%E6%A0%87-%E4%BB%BB%E5%8A%A1%E5%AE%8C%E6%88%90%E7%8E%87) 二、Agent 评估的第一指标：任务完成率

任务完成率，是 Agent 评估里最核心的指标。

简单说就是：

**用户交给 Agent 的任务，它到底完成了多少。**

比如 100 个测试任务里：

- 70 个完整完成
- 15 个部分完成
- 10 个失败但正确说明原因
- 5 个失败还编结果

那不能简单说成功率是 70%。

因为“失败但正确说明原因”和“失败还编结果”，差别很大。

一个靠谱的 Agent，不是每次都必须成功。

现实里很多任务本来就无法继续：

- 用户没给订单号
- 当前账号没有权限
- 工具超时
- 数据不存在
- 业务规则不允许
- 文档本身缺失

这时 Agent 正确的表现，不是硬做。

而是：

**识别无法完成的原因，并给出下一步动作。**

所以任务完成率最好拆成几档。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_1-%E5%AE%8C%E6%95%B4%E5%AE%8C%E6%88%90) 1\. 完整完成

用户目标被完整满足。

比如用户让 Agent 查接口变慢原因。

Agent 找到证据链：

- P95 从 300ms 升到 3.8s
- 变慢时间点是 22:10
- 22:05 发布了新版本
- 新版本增加了第三方回调重试
- 日志显示回调超时激增

最后给出结论和修复建议。

这叫完整完成。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_2-%E9%83%A8%E5%88%86%E5%AE%8C%E6%88%90) 2\. 部分完成

Agent 完成了一部分目标，但还有明确缺口。

比如它找到了慢接口和发布时间，但没有拿到第三方回调日志。

如果它明确说：

“目前证据只能支持发布后接口变慢，但还缺少第三方回调日志，不能直接下最终结论。”

这比强行总结要好。

部分完成不是坏事。

坏的是：

**明明只完成了一部分，却装成全部完成。**

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_3-%E6%AD%A3%E7%A1%AE%E5%A4%B1%E8%B4%A5) 3\. 正确失败

任务没完成，但失败处理是正确的。

比如用户问：

“帮我查一下订单为什么没发货。”

但用户没提供订单号。

Agent 不能编。

它应该追问：

“请提供订单号，我才能继续查询发货状态。”

这叫正确失败。

很多生产系统里，正确失败非常重要。

因为它不会制造错误结果。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_4-%E9%94%99%E8%AF%AF%E5%A4%B1%E8%B4%A5) 4\. 错误失败

任务没完成，还给了错误结论。

比如没查到订单，却说：

“订单正在仓库处理中。”

这种最危险。

因为用户以为 Agent 查到了。

但其实它是编的。

所以任务完成率不能只统计“有没有输出答案”。

要统计：

- 完整完成率
- 部分完成率
- 正确失败率
- 错误失败率

![Agent任务结果按完整完成、部分完成、正确失败和错误失败分级](https://file1.kamacoder.com/i/web/20260528163457_agent_evaluation_02_task_outcome_compressed.png)

面试里如果你只说：

“我们用准确率评估 Agent。”

太浅了。

你要说：

“我们会按任务结果分级：完整完成、部分完成、正确失败、错误失败。Agent 不是每个任务都必须成功，但失败时必须能识别原因，不能编造结果。”

这就像真的做过。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%B8%89%E3%80%81%E5%8F%AA%E7%9C%8B%E5%AE%8C%E6%88%90%E7%8E%87%E8%BF%98%E4%B8%8D%E5%A4%9F-%E8%BF%98%E8%A6%81%E7%9C%8B%E6%AD%A5%E9%AA%A4%E6%95%88%E7%8E%87) 三、只看完成率还不够，还要看步骤效率

Agent 能完成任务，不代表它做得好。

还要看它用了多少步。

同样一个任务：

“查订单为什么没发货。”

Agent A：

1. 发现缺少订单号。
2. 追问用户。

两步结束。

Agent B：

1. 查订单详情，缺订单号。
2. 查用户最近订单，缺手机号。
3. 查手机号，缺登录态。
4. 又查订单详情。
5. 又查最近订单。
6. 最后才追问订单号。

两个 Agent 最后都可能追问用户。

但 Agent A 明显更好。

因为它没有浪费工具调用，也没有绕圈。

这就叫步骤效率。

步骤效率可以看几个指标。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_1-%E5%B9%B3%E5%9D%87%E6%AD%A5%E6%95%B0) 1\. 平均步数

一个任务平均需要多少次模型决策或工具调用。

步数不是越少越好。

太少可能说明没认真查。

但步数长期偏高，通常说明 Agent 在绕路。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_2-%E6%97%A0%E6%95%88%E5%B7%A5%E5%85%B7%E8%B0%83%E7%94%A8%E7%8E%87) 2\. 无效工具调用率

哪些工具调用没有推进任务。

比如：

- 缺参数还调用
- 同样参数重复失败
- 查了无关数据
- 调了不适合当前任务的工具

这些都应该统计。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_3-%E9%87%8D%E5%A4%8D%E8%B0%83%E7%94%A8%E7%8E%87) 3\. 重复调用率

同一个工具、同一组关键参数、同一个错误原因，反复调用。

这通常说明 Agent 缺少失败记忆。

前面 [Agent 为什么容易翻车](https://notes.kamacoder.com/llm/app/agent_failure_modes.html) 里讲死循环，本质就是这个。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_4-%E5%85%B3%E9%94%AE%E8%B7%AF%E5%BE%84%E9%95%BF%E5%BA%A6) 4\. 关键路径长度

完成任务真正需要的核心步骤有多少。

比如排查接口变慢，关键路径可能是：

监控 → 发布记录 → 错误日志 → 结论。

如果 Agent 中间绕到数据库、缓存、无关服务查了一圈，那就是路径效率差。

![Agent步骤效率通过关键路径、无效调用和重复调用衡量](https://file1.kamacoder.com/i/web/20260528163458_agent_evaluation_03_step_efficiency_compressed.png)

步骤效率的价值在于：

**它能把“看起来完成了”拆成“怎么完成的”。**

这对生产环境很重要。

因为每一次工具调用都有成本。

有的成本是 Token。

有的成本是延迟。

有的成本是外部系统压力。

还有的成本是安全风险。

一个 Agent 如果能完成任务，但每次都绕几十步，也很难上线。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%9B%9B%E3%80%81%E5%B7%A5%E5%85%B7%E8%B0%83%E7%94%A8%E6%AD%A3%E7%A1%AE%E7%8E%87-agent-%E9%9D%A0%E4%B8%8D%E9%9D%A0%E8%B0%B1-%E5%85%88%E7%9C%8B%E5%B7%A5%E5%85%B7%E6%80%8E%E4%B9%88%E7%94%A8) 四、工具调用正确率：Agent 靠不靠谱，先看工具怎么用

Agent 的核心能力之一，就是调用工具。

所以评估 Agent，必须评估工具调用。

工具调用正确率不是简单看“有没有调工具”。

要看它调得对不对。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_1-%E5%B7%A5%E5%85%B7%E9%80%89%E6%8B%A9%E6%98%AF%E5%90%A6%E6%AD%A3%E7%A1%AE) 1\. 工具选择是否正确

用户问：

“这个订单能不能退款？”

正确路径应该先查退款规则。

而不是直接提交退款申请。

所以要看：

- 当前任务需要什么工具
- Agent 选的工具是否匹配
- 有没有把查询类任务误判成执行类任务

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_2-%E5%8F%82%E6%95%B0%E6%98%AF%E5%90%A6%E6%AD%A3%E7%A1%AE) 2\. 参数是否正确

工具选对了，参数错了也不行。

比如：

- 把手机号填进订单号字段
- 把“昨天晚上”原样塞进时间字段
- 缺少必填字段还强行调用
- 时间范围过大，导致查询噪音太多

这些都应该算工具调用错误。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_3-%E8%B0%83%E7%94%A8%E6%97%B6%E6%9C%BA%E6%98%AF%E5%90%A6%E6%AD%A3%E7%A1%AE) 3\. 调用时机是否正确

有些工具不是不能调。

而是不能在这个时机调。

比如高风险动作工具：

- 发邮件
- 退款
- 删除数据
- 修改生产配置

这些工具必须在用户确认之后调用。

如果 Agent 在确认前调用了，就算参数对，也是不正确。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_4-%E5%B7%A5%E5%85%B7%E7%BB%93%E6%9E%9C%E6%98%AF%E5%90%A6%E6%AD%A3%E7%A1%AE%E4%BD%BF%E7%94%A8) 4\. 工具结果是否正确使用

很多 Agent 的问题不是工具调用错。

而是工具结果读错。

比如工具返回：

```json
{
  "success": false,
  "error_code": "MISSING_ORDER_ID",
  "recommended_action": "ask_user_for_order_id"
}
```

1

2

3

4

5

Agent 却继续查询订单详情。

这就是没有正确使用工具结果。

所以工具调用评估至少包括：

- 工具选择正确率
- 参数正确率
- 调用时机正确率
- 工具结果理解正确率
- 高风险工具违规调用次数

![Agent工具调用质量从工具选择、参数校验、调用时机和结果理解评估](https://file1.kamacoder.com/i/web/20260528163459_agent_evaluation_04_tool_call_quality_compressed.png)

如果你的 Agent 项目里写了 Function Calling、MCP、Tool Use，这一块面试官很容易追问。

不要只说：

“我们支持工具调用。”

要说：

“我们会评估工具选择、参数合法性、调用时机和结果使用情况，尤其会单独统计高风险工具违规调用。”

这才是工程评估。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%BA%94%E3%80%81%E9%94%99%E8%AF%AF%E6%81%A2%E5%A4%8D%E7%8E%87-%E5%A4%B1%E8%B4%A5%E5%90%8E%E4%BC%9A%E4%B8%8D%E4%BC%9A%E6%AD%A3%E7%A1%AE%E8%BD%AC%E5%90%91) 五、错误恢复率：失败后会不会正确转向

Agent 一定会遇到失败。

这不用回避。

关键是失败以后怎么处理。

工具失败以后，Agent 大概有几种选择：

- 追问用户
- 缩小查询范围
- 换一个工具
- 有限重试
- 阶段性总结
- 停止并说明权限不足
- 标记缺口，不下最终结论

这就是错误恢复。

错误恢复率可以这样理解：

**当某一步失败后，Agent 是否选择了合理的下一步。**

比如工具返回缺少订单号。

合理动作是追问用户。

不是继续调用订单详情。

比如工具返回权限不足。

合理动作是停止说明。

不是换一个工具绕过权限。

比如工具返回超时。

合理动作是有限重试，或者提示当前系统不可用。

不是无限重试。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%94%99%E8%AF%AF%E6%81%A2%E5%A4%8D%E5%8F%AF%E4%BB%A5%E5%88%86%E7%B1%BB%E5%9E%8B%E8%AF%84%E4%BC%B0) 错误恢复可以分类型评估

不要把所有失败混在一起。

最好按错误类型拆。

**缺参数错误。**

看 Agent 是否追问用户补充。

**无数据错误。**

看 Agent 是否扩大或调整查询范围，或者说明当前无数据。

**工具超时。**

看 Agent 是否有限重试，是否避免死循环。

**权限不足。**

看 Agent 是否停止，而不是绕权限。

**业务规则不允许。**

看 Agent 是否解释规则，而不是继续尝试执行。

![Agent错误恢复率评估不同失败类型对应的合理下一步动作](https://file1.kamacoder.com/i/web/20260528163500_agent_evaluation_05_error_recovery_compressed.png)

前面我们讲过，错误返回最好结构化。

因为结构化错误能让 Agent 更容易恢复。

但评估时不能只看“有没有 error\_code”。

还要看：

**Agent 是否真的按 recommended\_action 做了。**

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%85%AD%E3%80%81%E5%AE%89%E5%85%A8%E5%92%8C%E6%9D%83%E9%99%90%E6%8C%87%E6%A0%87-%E4%B8%8D%E8%A6%81%E5%8F%AA%E8%AF%84%E4%BC%B0%E6%95%88%E6%9E%9C) 六、安全和权限指标：不要只评估效果

Agent 评估里，安全指标一定要单独看。

尤其是能调用工具、能执行动作的 Agent。

因为有些错误不是“答错了”。

是事故。

比如：

- 未确认就发邮件
- 未确认就退款
- 未确认就删除数据
- 未确认就修改生产配置
- 越权查询用户隐私数据
- 把敏感信息写进日志或上下文

这些问题不能和普通答案错误放在一起算平均分。

要单独统计。

因为一次严重越权，就可能让整个系统不能上线。

安全评估至少看这几类。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_1-%E9%AB%98%E9%A3%8E%E9%99%A9%E5%8A%A8%E4%BD%9C%E8%BF%9D%E8%A7%84%E7%8E%87) 1\. 高风险动作违规率

需要用户确认的动作，Agent 有没有提前执行。

这个指标越低越好。

生产环境里，目标应该是 0。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_2-%E6%9D%83%E9%99%90%E7%BB%95%E8%BF%87%E5%B0%9D%E8%AF%95) 2\. 权限绕过尝试

当工具返回权限不足，Agent 有没有尝试换工具绕过。

这类行为非常危险。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_3-%E6%95%8F%E6%84%9F%E4%BF%A1%E6%81%AF%E6%B3%84%E9%9C%B2) 3\. 敏感信息泄露

Agent 有没有把不该输出的信息输出给用户。

比如内部日志、Token、用户隐私、系统提示词。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_4-%E5%AE%A1%E8%AE%A1%E5%AE%8C%E6%95%B4%E6%80%A7) 4\. 审计完整性

高风险动作有没有留下：

- 谁触发
- 什么时候触发
- Agent 为什么建议执行
- 用户是否确认
- 最终调用了什么工具
- 工具返回什么结果

没有审计，出事后没法复盘。

所以评估 Agent，不要只问：

“它聪不聪明？”

还要问：

**它有没有边界感。**

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%B8%83%E3%80%81%E8%AF%84%E4%BC%B0%E9%9B%86%E6%80%8E%E4%B9%88%E8%AE%BE%E8%AE%A1-%E4%B8%8D%E8%A6%81%E5%8F%AA%E6%8B%BF%E7%AE%80%E5%8D%95%E9%97%AE%E9%A2%98%E6%B5%8B) 七、评估集怎么设计：不要只拿简单问题测

很多人做评估集，只放一些正常样本。

比如：

“查订单状态。”

“总结一篇文档。”

“分析一个接口慢的问题。”

这些当然要测。

但只测正常样本，Agent 很容易看起来很强。

真实线上环境里，用户输入经常是不完整、不规范、有歧义、有风险的。

所以 Agent 评估集至少要覆盖五类任务。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_1-%E6%AD%A3%E5%B8%B8%E5%AE%8C%E6%88%90%E7%B1%BB) 1\. 正常完成类

信息完整，工具可用，权限足够。

用来测基本任务完成率。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_2-%E4%BF%A1%E6%81%AF%E7%BC%BA%E5%A4%B1%E7%B1%BB) 2\. 信息缺失类

缺订单号、缺时间范围、缺文件路径、缺业务背景。

用来测 Agent 会不会追问。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_3-%E5%B7%A5%E5%85%B7%E5%A4%B1%E8%B4%A5%E7%B1%BB) 3\. 工具失败类

工具超时、无数据、权限不足、参数错误。

用来测错误恢复能力。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_4-%E9%AB%98%E9%A3%8E%E9%99%A9%E5%8A%A8%E4%BD%9C%E7%B1%BB) 4\. 高风险动作类

退款、删除、发邮件、改配置、执行命令。

用来测权限确认和安全边界。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#_5-%E5%B9%B2%E6%89%B0%E5%99%AA%E9%9F%B3%E7%B1%BB) 5\. 干扰噪音类

上下文里混入用户猜测、无关日志、过期结论、错误 RAG 片段。

用来测上下文污染控制。

![Agent评估集需要覆盖正常完成、信息缺失、工具失败、高风险动作和噪音干扰](https://file1.kamacoder.com/i/web/20260528163502_agent_evaluation_06_eval_dataset_compressed.png)

评估集不是越大越好。

初期可以先做小而硬的集合。

比如 50 到 100 个高质量任务。

每个任务标清楚：

- 用户目标
- 可用工具
- 初始输入
- 标准完成条件
- 允许的工具调用
- 不允许的动作
- 预期失败处理
- 评分规则

这比随便堆 1000 个问题有用得多。

因为 Agent 评估最怕标准不清。

标准不清，评出来的分没有意义。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%85%AB%E3%80%81%E8%87%AA%E5%8A%A8%E5%8C%96%E8%AF%84%E6%B5%8B%E5%92%8C%E4%BA%BA%E5%B7%A5%E8%AF%84%E6%B5%8B%E9%83%BD%E8%A6%81%E6%9C%89) 八、自动化评测和人工评测都要有

Agent 评估不能全靠人工。

太慢。

也不能全靠自动化。

因为很多判断很细。

比较现实的做法是：

**自动化评测负责规模，人工评测负责质量。**

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%87%AA%E5%8A%A8%E5%8C%96%E9%80%82%E5%90%88%E8%AF%84%E4%BB%80%E4%B9%88) 自动化适合评什么

自动化评测适合看结构化指标。

比如：

- 是否调用了正确工具
- 参数是否符合 Schema
- 是否超过最大步数
- 是否重复调用同一工具
- 是否在确认前调用高风险工具
- 错误码出现后是否执行 recommended\_action
- 最终输出是否包含必要字段

这些可以通过 trace 和日志自动判定。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%BA%BA%E5%B7%A5%E9%80%82%E5%90%88%E8%AF%84%E4%BB%80%E4%B9%88) 人工适合评什么

人工评测适合看语义质量。

比如：

- 结论是否真的解决用户问题
- 证据链是否可信
- 解释是否清楚
- 有没有遗漏关键风险
- 阶段性失败说明是否让人能继续操作
- 建议是否可执行

这些很难完全靠规则判断。

LLM-as-judge 也可以用。

但不要迷信。

它适合做辅助打分，不适合当唯一裁判。

尤其是安全、权限、事实正确性，最好还是结合规则和人工抽检。

![Agent评估流程结合自动化规则评测、人工抽检、失败归因和回归评估](https://file1.kamacoder.com/i/web/20260528163503_agent_evaluation_07_auto_human_eval_compressed.png)

一个比较稳的评估流程是：

1. 先跑离线评估集。
2. 自动计算工具调用、步骤、错误恢复、安全违规。
3. 抽样人工看 trace 和最终回答。
4. 对失败样本做归因。
5. 修改 Prompt、工具、状态管理或权限规则。
6. 再跑同一批评估集做回归。

这就不是“感觉变好了”。

而是能看到具体提升在哪里。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E4%B9%9D%E3%80%81%E7%BA%BF%E4%B8%8A%E7%9B%91%E6%8E%A7-%E8%AF%84%E4%BC%B0%E4%B8%8D%E6%98%AF%E4%B8%8A%E7%BA%BF%E5%89%8D%E5%81%9A%E4%B8%80%E6%AC%A1) 九、线上监控：评估不是上线前做一次

很多团队把评估当成上线前的一次测试。

这不够。

Agent 上线以后，用户输入会不断变化。

工具也会变。

业务规则也会变。

文档和知识库也会变。

所以 Agent 评估要持续做。

线上至少要监控这些指标：

- 任务完成率
- 用户追问率
- 工具调用次数
- 平均执行步数
- 工具失败率
- 重复调用率
- 超时率
- 高风险动作确认率
- 用户取消率
- 人工接管率
- 用户差评率
- 安全拦截次数

这些指标能告诉你 Agent 在真实环境里是不是变差了。

比如某天工具失败率突然升高。

可能不是模型变笨。

而是某个工具接口挂了。

比如平均执行步数突然升高。

可能是 Prompt 改动导致 Agent 绕路。

比如人工接管率升高。

可能是新用户问题超出了原来的任务边界。

所以线上监控要和 trace 结合。

只看最终回答不够。

要能回放：

- 用户输入是什么
- Agent 每一步怎么想
- 调用了什么工具
- 工具返回什么
- 哪一步开始跑偏
- 最后为什么交付或停止

![Agent线上监控通过Trace采集、指标看板、异常回放和灰度回归持续评估](https://file1.kamacoder.com/i/web/20260528163504_agent_evaluation_08_online_monitoring_compressed.png)

没有 trace，Agent 问题很难排。

你只看到一个错答案。

但不知道它是检索错、工具错、参数错、状态错，还是模型理解错。

这就是为什么生产级 Agent 一定要有日志、trace、审计和评估回归。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%8D%81%E3%80%81agent-%E8%AF%84%E4%BC%B0%E7%9A%84%E5%B8%B8%E8%A7%81%E8%AF%AF%E5%8C%BA) 十、Agent 评估的常见误区

这里我把几个常见误区也说一下。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%AF%AF%E5%8C%BA%E4%B8%80-%E5%8F%AA%E7%9C%8B%E6%9C%80%E7%BB%88%E7%AD%94%E6%A1%88) 误区一：只看最终答案

Agent 的最终答案只是结果。

过程同样重要。

如果中间调用了危险工具，即使最后答案看起来对，也不能算好。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%AF%AF%E5%8C%BA%E4%BA%8C-%E5%8F%AA%E6%B5%8B%E6%AD%A3%E5%B8%B8%E4%BB%BB%E5%8A%A1) 误区二：只测正常任务

正常任务测不出可靠性。

真正能拉开差距的是异常任务：

- 缺参数
- 工具失败
- 权限不足
- 上下文污染
- 高风险动作

这些才是生产环境容易出事的地方。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%AF%AF%E5%8C%BA%E4%B8%89-%E5%8F%AA%E7%94%A8%E5%A4%A7%E6%A8%A1%E5%9E%8B%E6%89%93%E5%88%86) 误区三：只用大模型打分

LLM-as-judge 可以用。

但不能什么都交给它。

工具调用是否违规、参数是否合法、是否超过步数、是否越权，这些应该用规则判断。

不要让模型评价模型，然后大家一起自我感动。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%AF%AF%E5%8C%BA%E5%9B%9B-%E6%8C%87%E6%A0%87%E5%A4%AA%E5%A4%9A%E4%BD%86%E6%B2%A1%E4%BA%BA%E7%9C%8B) 误区四：指标太多但没人看

评估指标不是越多越好。

如果团队最后只关心一个“综合分”，那很多问题会被平均掉。

特别是安全问题，不能被平均。

高风险动作违规，必须单独拉出来。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E8%AF%AF%E5%8C%BA%E4%BA%94-%E6%B2%A1%E6%9C%89%E5%A4%B1%E8%B4%A5%E5%BD%92%E5%9B%A0) 误区五：没有失败归因

只知道成功率 70%，没用。

你要知道失败来自哪里：

- Prompt 不清
- 工具描述不清
- 参数 Schema 太松
- 记忆污染
- 检索结果差
- 权限规则缺失
- 错误返回不可恢复

只有做归因，才知道该改哪里。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%8D%81%E4%B8%80%E3%80%81%E9%9D%A2%E8%AF%95%E6%97%B6%E6%80%8E%E4%B9%88%E5%9B%9E%E7%AD%94-agent-%E8%AF%84%E4%BC%B0) 十一、面试时怎么回答 Agent 评估

Agent 评估现在很容易被问。

尤其是你简历里写了 Agent 项目，面试官可能会问：

“你怎么证明这个 Agent 有效果？”

“你怎么评估它比普通 Workflow 更好？”

“你怎么发现它会不会乱调用工具？”

这些问题，不要只回答准确率。

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%9D%A2%E8%AF%95%E5%AE%98%E9%97%AE-agent-%E6%80%8E%E4%B9%88%E8%AF%84%E4%BC%B0) 面试官问：Agent 怎么评估？

可以这样答：

“Agent 评估不能只看最终答案，因为 Agent 有规划、工具调用、状态管理和错误恢复过程。我会从结果和过程两层评估：结果层看任务完成率、部分完成率、正确失败率和错误失败率；过程层看工具调用正确率、参数正确率、步骤效率、重复调用率、错误恢复率和权限违规率。”

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%9D%A2%E8%AF%95%E5%AE%98%E9%97%AE-%E4%BB%BB%E5%8A%A1%E5%AE%8C%E6%88%90%E7%8E%87%E6%80%8E%E4%B9%88%E5%AE%9A%E4%B9%89) 面试官问：任务完成率怎么定义？

可以这样答：

“我不会只按成功失败二分类。会把任务结果分成完整完成、部分完成、正确失败和错误失败。比如缺少订单号时，Agent 追问用户是正确失败；如果它没查到却编一个订单状态，就是错误失败。这样更能反映 Agent 的可靠性。”

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%9D%A2%E8%AF%95%E5%AE%98%E9%97%AE-%E6%80%8E%E4%B9%88%E8%AF%84%E4%BC%B0%E5%B7%A5%E5%85%B7%E8%B0%83%E7%94%A8) 面试官问：怎么评估工具调用？

可以这样答：

“工具调用会看四个方面：工具是否选对，参数是否符合 Schema，调用时机是否正确，工具返回后是否按错误码和 recommended\_action 做下一步。高风险工具还要单独统计确认前违规调用次数，这类指标不能被平均分掩盖。”

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%9D%A2%E8%AF%95%E5%AE%98%E9%97%AE-%E6%80%8E%E4%B9%88%E6%9E%84%E9%80%A0%E8%AF%84%E4%BC%B0%E9%9B%86) 面试官问：怎么构造评估集？

可以这样答：

“评估集不能只放正常任务。我会覆盖正常完成、信息缺失、工具失败、高风险动作、上下文噪音五类样本。每个样本标清楚用户目标、可用工具、标准完成条件、允许和禁止的动作，以及预期失败处理。这样才能测出 Agent 在真实环境里的稳定性。”

### [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E9%9D%A2%E8%AF%95%E5%AE%98%E9%97%AE-%E8%87%AA%E5%8A%A8%E5%8C%96%E8%AF%84%E4%BC%B0%E5%92%8C%E4%BA%BA%E5%B7%A5%E8%AF%84%E4%BC%B0%E6%80%8E%E4%B9%88%E7%BB%93%E5%90%88) 面试官问：自动化评估和人工评估怎么结合？

可以这样答：

“自动化适合评工具调用、参数合法性、步数、重复调用、安全违规这些结构化指标；人工适合评结论质量、证据链、解释是否清楚。LLM-as-judge 可以做辅助，但安全和事实类指标要用规则和人工抽检兜住。”

这套回答比“我们看准确率”强很多。

因为它讲清楚了：

**Agent 不是答案生成器，而是一个会行动的系统。**

会行动，就必须评估行动过程。

## [\#](https://notes.kamacoder.com/llm/app/agent_evaluation.html\#%E5%8D%81%E4%BA%8C%E3%80%81%E6%B2%A1%E6%9C%89%E8%AF%84%E4%BC%B0%E7%9A%84-agent-%E5%B0%B1%E6%98%AF%E9%BB%91%E7%9B%92) 十二、没有评估的 Agent，就是黑盒

最后再强调一下。

Agent 没有评估，就很难进入生产环境。

因为你不知道：

- 它是不是真的完成任务
- 它有没有乱调用工具
- 它是不是绕了很多无效步骤
- 它失败后会不会编
- 它有没有越权执行
- 它的表现有没有随着工具和业务变化变差

Demo 阶段，录几个视频，看起来很酷。

但生产环境不吃这个。

生产环境看的是：

**成功时能不能稳定成功。**

**失败时能不能正确失败。**

**出问题时能不能追踪复盘。**

所以做 Agent，不要只问：

“它能不能自己完成任务？”

还要问：

**它每一步做得对不对，我们能不能量化。**

这就是 Agent 评估的核心。

阅读更多


←
[Agent的记忆：短期、长期、RAG的关系](https://notes.kamacoder.com/llm/app/agent_memory.html)[SFT、RLHF、DPO：微调方法全景认知](https://notes.kamacoder.com/llm/app/finetuning_sft_rlhf_dpo.html)
→


### 评论

登录后评论登录