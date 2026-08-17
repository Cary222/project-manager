---
source: https://notes.kamacoder.com/llm/claude/claude_md.html
category: claude
scraped_at: 2026-08-14T07:51:09.490Z
---

# [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#claude-md%E5%88%B0%E5%BA%95%E6%80%8E%E4%B9%88%E5%86%99-claude-code%E9%A1%B9%E7%9B%AE%E8%AE%B0%E5%BF%86%E3%80%81%E5%9B%A2%E9%98%9F%E8%A7%84%E8%8C%83%E5%92%8C%E4%B8%8A%E4%B8%8B%E6%96%87%E7%AE%A1%E7%90%86%E4%B8%80%E7%AF%87%E8%AE%B2%E6%98%8E%E7%99%BD) CLAUDE.md到底怎么写？Claude Code项目记忆、团队规范和上下文管理一篇讲明白

[![卡码笔记](https://file1.kamacoder.com/i/web/2025-08-14kamabij.jpg)\\
\\
公众号@卡码笔记原创\\
\\
2026-07-30·全文 5379 字\\
\\
![公众号二维码](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)扫码关注公众号](https://file1.kamacoder.com/i/web/%E5%8D%A1%E7%A0%81%E7%AC%94%E8%AE%B0.jpg)

录友们好，今天聊一个 Claude Code 里特别容易被低估的文件：`CLAUDE.md`。

很多录友用 Claude Code 写代码时，都遇到过这种情况：

你第一轮告诉它："这个项目用 pnpm，不要用 npm。"

过一会儿，它又开始建议 `npm install`。

你告诉它："不要直接改数据库表结构。"

修着修着，它又想动 schema。

你告诉它："改完要跑单测。"

它把代码改完了，准备收工。

> 不少读者问我，如何充值Claude会员，我在这里篇单独讲一下： [国内Claude充值会员的方法](https://notes.kamacoder.com/qita/0002.claudepay.html)

这时候很多人会觉得：是不是模型不听话？

不完全是。

更大的问题是： **你把项目长期规则，当成了临时聊天内容。**

临时聊天内容会被上下文挤压，会被压缩，会随着任务变长而变得越来越不稳定。

但项目规则不应该每次都靠嘴说。

`CLAUDE.md` 就是为了解决这个问题的。

它不是玄学提示词，也不是项目 README 的复制版。

它更像是 Claude Code 进项目之前要看的"工作说明书"。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E7%9B%AE%E5%BD%95) 目录

01. [为什么你总是在重复教育 Claude Code？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%B8%80%E4%B8%BA%E4%BB%80%E4%B9%88%E4%BD%A0%E6%80%BB%E6%98%AF%E5%9C%A8%E9%87%8D%E5%A4%8D%E6%95%99%E8%82%B2-claude-code)
02. [CLAUDE.md 到底是什么？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%BA%8Cclaudemd-%E5%88%B0%E5%BA%95%E6%98%AF%E4%BB%80%E4%B9%88)
03. [它和 README、Prompt、Memory 有什么区别？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%B8%89%E5%AE%83%E5%92%8C-readmepromptmemory-%E6%9C%89%E4%BB%80%E4%B9%88%E5%8C%BA%E5%88%AB)
04. [CLAUDE.md 应该放在哪里？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%9B%9Bclaudemd-%E5%BA%94%E8%AF%A5%E6%94%BE%E5%9C%A8%E5%93%AA%E9%87%8C)
05. [什么内容值得写进去？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%BA%94%E4%BB%80%E4%B9%88%E5%86%85%E5%AE%B9%E5%80%BC%E5%BE%97%E5%86%99%E8%BF%9B%E5%8E%BB)
06. [什么内容不要写进去？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%85%AD%E4%BB%80%E4%B9%88%E5%86%85%E5%AE%B9%E4%B8%8D%E8%A6%81%E5%86%99%E8%BF%9B%E5%8E%BB)
07. [怎么写才真的有效？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%B8%83%E6%80%8E%E4%B9%88%E5%86%99%E6%89%8D%E7%9C%9F%E7%9A%84%E6%9C%89%E6%95%88)
08. [大项目怎么拆 CLAUDE.md？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%85%AB%E5%A4%A7%E9%A1%B9%E7%9B%AE%E6%80%8E%E4%B9%88%E6%8B%86-claudemd)
09. [CLAUDE.md 和上下文窗口有什么关系？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E4%B9%9Dclaudemd-%E5%92%8C%E4%B8%8A%E4%B8%8B%E6%96%87%E7%AA%97%E5%8F%A3%E6%9C%89%E4%BB%80%E4%B9%88%E5%85%B3%E7%B3%BB)
10. [给你一个可以直接抄的模板](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%8D%81%E7%BB%99%E4%BD%A0%E4%B8%80%E4%B8%AA%E5%8F%AF%E4%BB%A5%E7%9B%B4%E6%8E%A5%E6%8A%84%E7%9A%84%E6%A8%A1%E6%9D%BF)
11. [团队里怎么维护 CLAUDE.md？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%8D%81%E4%B8%80%E5%9B%A2%E9%98%9F%E9%87%8C%E6%80%8E%E4%B9%88%E7%BB%B4%E6%8A%A4-claudemd)
12. [面试和工作中怎么讲这个能力？](https://notes.kamacoder.com/llm/claude/claude_md.html#%E5%8D%81%E4%BA%8C%E9%9D%A2%E8%AF%95%E5%92%8C%E5%B7%A5%E4%BD%9C%E4%B8%AD%E6%80%8E%E4%B9%88%E8%AE%B2%E8%BF%99%E4%B8%AA%E8%83%BD%E5%8A%9B)

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%B8%80%E3%80%81%E4%B8%BA%E4%BB%80%E4%B9%88%E4%BD%A0%E6%80%BB%E6%98%AF%E5%9C%A8%E9%87%8D%E5%A4%8D%E6%95%99%E8%82%B2-claude-code) 一、为什么你总是在重复教育 Claude Code？

先说一个很常见的场景。

你打开一个老项目，让 Claude Code 帮你改一个接口。

你会先说一大堆：

- 这个项目是 VuePress 1.x，不要按 VuePress 2.x 写
- 命令要在 `docs/` 目录下执行
- 依赖版本别乱升
- 不要改部署脚本
- Markdown 图片必须有 ALT
- 改完之后跑 `npm run build`

这些话有用吗？

有用。

但问题是： **你每次开新任务都要说一遍。**

更麻烦的是，复杂任务跑久了以后，上下文越来越长，前面那些要求会被一堆文件内容、命令输出、错误日志淹没。

你以为 Claude Code "记得"这些规则，其实它只是当前上下文里还能看到这些规则。

一旦上下文压缩、裁剪、切换任务，它就可能忘。

所以项目规则不能只靠聊天输入。

它需要一个更稳定的入口。

这就是 `CLAUDE.md`。

**你可以把它理解成：写给 Claude Code 的项目交接文档。**

新人进组之前，你会告诉他：

- 项目怎么启动
- 哪些目录放什么
- 哪些地方不能动
- 常见坑在哪里
- 提 PR 前要跑什么检查

Claude Code 也是一样。

你不能指望它每次都自己摸索一遍。

摸索会浪费 token，也会制造风险。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%BA%8C%E3%80%81claude-md-%E5%88%B0%E5%BA%95%E6%98%AF%E4%BB%80%E4%B9%88) 二、CLAUDE.md 到底是什么？

`CLAUDE.md` 是一个普通的 Markdown 文件。

Claude Code 会自动读取它，把里面的内容作为项目上下文的一部分。

注意几个关键词：

**第一，它是普通 Markdown。**

不是配置文件，不是 JSON，不是 YAML，不需要写复杂语法。

你就按正常文档写：

```md
# 项目说明

- 使用 pnpm 管理依赖
- 开发命令：pnpm dev
- 构建命令：pnpm build
- 不要直接修改数据库 schema
```

1

2

3

4

5

6

**第二，它是给 Claude Code 看的。**

README 主要给人看，`CLAUDE.md` 主要给 AI 编程 Agent 看。

所以它不用写项目愿景、业务背景长文、团队文化。

它要写的是能直接影响 Claude Code 行动的信息。

**第三，它会进入上下文。**

这点很重要。

`CLAUDE.md` 不是在外面摆着好看的文档。

Claude Code 读到它之后，里面的规则会参与后续推理。

所以它能让 Claude Code 更稳定，但也会占上下文窗口。

这就决定了一个原则：

**CLAUDE.md 要短、准、可执行。**

不是越长越好。

![图1：临时聊天规则会被上下文稀释，CLAUDE.md 能把长期规则沉淀成稳定约束](https://file1.kamacoder.com/i/web/20260527112101_claude_md_01_positioning_compressed.png)

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%B8%89%E3%80%81%E5%AE%83%E5%92%8C-readme%E3%80%81prompt%E3%80%81memory-%E6%9C%89%E4%BB%80%E4%B9%88%E5%8C%BA%E5%88%AB) 三、它和 README、Prompt、Memory 有什么区别？

很多录友会问：那我已经有 README 了，还要 `CLAUDE.md` 干嘛？

这俩不是一个东西。

README 的读者是人。

它通常会写：

- 项目介绍
- 功能说明
- 安装方式
- 使用文档
- 贡献指南

这些信息对人很友好，但对 Agent 不一定高效。

因为 Claude Code 真正需要的是行动约束：

- 这个任务应该从哪个目录入手
- 改代码前先看哪些文件
- 用哪个命令验证
- 哪些文件不要碰
- 遇到某类错误先检查哪里

Prompt 又不一样。

Prompt 是当前任务的临时要求。

比如你说："帮我修登录失败，但不要改后端接口。"

这句话就适合放当前对话里。

因为它只对这次任务生效。

而 `CLAUDE.md` 适合放跨任务都稳定的规则。

比如：

- 项目统一用 TypeScript
- 测试命令是什么
- API 层统一走 `src/api`
- UI 组件不要直接请求接口
- 禁止提交真实 token

Memory 也要分清。

Claude Code 的 memory 有多种层级，比如用户级、项目级、企业级。

`CLAUDE.md` 本身就是一种项目记忆。

但你个人的习惯，比如"我喜欢先看计划再改代码"，更适合放用户级记忆。

团队共享规则，才适合放项目里的 `CLAUDE.md`。

![图2：不同类型的信息要分流到 README、Prompt、CLAUDE.md 和用户记忆](https://file1.kamacoder.com/i/web/20260527112102_claude_md_02_boundaries_compressed.png)

一句话区分：

**README 告诉人怎么理解项目，Prompt 告诉模型这次要做什么，CLAUDE.md 告诉 Claude Code 在这个项目里怎么干活。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%9B%9B%E3%80%81claude-md-%E5%BA%94%E8%AF%A5%E6%94%BE%E5%9C%A8%E5%93%AA%E9%87%8C) 四、CLAUDE.md 应该放在哪里？

这块是最容易乱的地方。

Claude Code 的 memory 不是只有一个位置。

常见位置有这几类。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_1-%E7%94%A8%E6%88%B7%E7%BA%A7-claude-claude-md) 1\. 用户级：`~/.claude/CLAUDE.md`

这个文件属于你个人。

适合放你跨项目都稳定的偏好。

比如：

- 默认先解释风险再改代码
- 优先使用项目现有命令
- 修改代码后尽量运行相关测试
- 回答时用中文

这些不属于某个项目，而是你个人的工作习惯。

所以不要把它提交到仓库里。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_2-%E9%A1%B9%E7%9B%AE%E7%BA%A7-claude-md-%E6%88%96-claude-claude-md) 2\. 项目级：`./CLAUDE.md` 或 `./.claude/CLAUDE.md`

这是最常用的位置。

适合放团队共享的项目规则。

比如：

- 项目架构
- 常用命令
- 代码风格
- 测试方式
- 禁止改动范围
- 常见问题排查

这个文件可以进 Git。

团队所有人用 Claude Code 时，都能获得同一套项目规则。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_3-%E5%AD%90%E7%9B%AE%E5%BD%95%E7%BA%A7-%E6%A8%A1%E5%9D%97%E8%87%AA%E5%B7%B1%E7%9A%84-claude-md) 3\. 子目录级：模块自己的 `CLAUDE.md`

大仓库里，一个根目录 `CLAUDE.md` 往往不够。

比如：

```text
project/
  CLAUDE.md
  frontend/
    CLAUDE.md
  backend/
    CLAUDE.md
  docs/
    CLAUDE.md
```

1

2

3

4

5

6

7

8

前端、后端、文档的规则不一样。

强行塞进一个根文件，会越来越长，Claude Code 反而抓不住重点。

更好的方式是根文件写全局规则，子目录文件写模块规则。

官方文档里也提到，Claude Code 会从当前工作目录往上查找记忆；当前工作目录下面更深层的 `CLAUDE.md`，通常会在 Claude 读取对应子树文件时再纳入上下文。

这对大项目很有用。

**不要让前端任务背着后端所有细节跑，也不要让文档任务背着数据库规则跑。**

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_4-%E7%A7%81%E4%BA%BA%E9%A1%B9%E7%9B%AE%E5%81%8F%E5%A5%BD-%E6%9B%B4%E6%8E%A8%E8%8D%90%E7%94%A8-import) 4\. 私人项目偏好：更推荐用 import

以前有些场景会用 `CLAUDE.local.md` 放个人项目偏好。

但现在更推荐在项目记忆里用 `@path` import 引入个人文件。

比如：

```md
# 个人偏好

- @~/.claude/my-project-preferences.md
```

1

2

3

这样个人规则不用进仓库，也更适合多 worktree 场景。

`@path` import 还可以引入项目里的其他文档。

比如：

```md
请参考 @README.md 了解项目概览。
测试规范见 @docs/testing.md。
```

1

2

但这里也要克制。

不要把一堆长文档全 import 进来。

能引用关键文档很好，滥用 import 就会把上下文变成垃圾桶。

![图3：多级 CLAUDE.md 按任务路径加载，避免无关模块规则污染上下文](https://file1.kamacoder.com/i/web/20260527112104_claude_md_03_scope_compressed.png)

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%BA%94%E3%80%81%E4%BB%80%E4%B9%88%E5%86%85%E5%AE%B9%E5%80%BC%E5%BE%97%E5%86%99%E8%BF%9B%E5%8E%BB) 五、什么内容值得写进去？

判断一条信息该不该写进 `CLAUDE.md`，我有一个很简单的标准：

**它是否会反复影响 Claude Code 的行动？**

如果会，就值得写。

如果只对当前一次任务有效，就放 prompt。

如果只是给人看的背景，就放 README。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_1-%E5%B8%B8%E7%94%A8%E5%91%BD%E4%BB%A4) 1\. 常用命令

这是最应该写的。

比如：

```md
## 常用命令

- 安装依赖：pnpm install
- 本地开发：pnpm dev
- 单元测试：pnpm test
- 构建检查：pnpm build
```

1

2

3

4

5

6

命令一定要写完整。

尤其是 monorepo 或 VuePress 这类项目，经常要求在特定目录执行。

比如：

```md
- 所有命令都在 `docs/` 目录下执行。
- 开发服务器：`cd docs && npm run dev`
- 构建：`cd docs && npm run build`
```

1

2

3

这比你每次提醒它强太多。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_2-%E9%A1%B9%E7%9B%AE%E7%BB%93%E6%9E%84) 2\. 项目结构

写目录职责，不要贴完整文件树。

比如：

```md
## 目录结构

- `src/components/`：通用 UI 组件
- `src/pages/`：页面入口
- `src/api/`：接口封装，组件不要直接调用 fetch
- `src/store/`：全局状态
- `tests/`：单元测试和集成测试
```

1

2

3

4

5

6

7

这能帮助 Claude Code 少走弯路。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_3-%E7%BC%96%E7%A0%81%E8%A7%84%E8%8C%83) 3\. 编码规范

写具体规则。

不要写：

```md
- 保持代码优雅
```

1

这句话没用。

要写：

```md
- 新组件使用函数组件
- 样式优先使用已有 token，不新增散乱颜色
- API 错误统一通过 `handleApiError()` 处理
- 不要在组件中直接写请求逻辑
```

1

2

3

4

**越具体，越有用。**

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_4-%E7%A6%81%E6%AD%A2%E4%BA%8B%E9%A1%B9) 4\. 禁止事项

这类信息非常适合放 `CLAUDE.md`。

比如：

```md
## 禁止事项

- 不要修改数据库 schema，除非用户明确要求。
- 不要升级核心依赖版本。
- 不要提交 `.env`、token、密钥。
- 不要重写历史迁移文件。
- 不要删除用户已有改动。
```

1

2

3

4

5

6

7

AI 编程最怕的不是写得慢，而是乱动不该动的地方。

禁止事项写清楚，能减少很多事故。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_5-%E9%AA%8C%E8%AF%81%E6%B5%81%E7%A8%8B) 5\. 验证流程

很多项目不是改完就完了。

要写清楚什么改动跑什么检查。

比如：

```md
## 验证要求

- 修改业务逻辑后，优先运行相关单测。
- 修改公共组件后，运行组件测试和构建。
- 修改依赖或配置后，运行完整构建。
- 如果测试无法运行，要在最终说明里写明原因。
```

1

2

3

4

5

6

这能让 Claude Code 更像一个靠谱同事。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_6-%E5%B8%B8%E8%A7%81%E5%9D%91) 6\. 常见坑

项目里有些坑，人踩过一次就知道。

AI 不知道。

所以要写。

比如：

```md
## 常见坑

- VuePress 1.x 插件必须使用 `@vuepress/back-to-top`，不要写成 VuePress 2.x 的插件名。
- dev 模式关闭了文件监听，改完文件需要手动刷新浏览器。
- 图片必须使用上传后的图床地址，不要引用本地临时文件。
```

1

2

3

4

5

这种信息放在聊天里很容易丢。

放在 `CLAUDE.md` 里，价值很高。

![图4：一条信息能不能写进 CLAUDE.md，要经过反复性、行动性和可维护性判断](https://file1.kamacoder.com/i/web/20260527112106_claude_md_04_decision_compressed.png)

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%85%AD%E3%80%81%E4%BB%80%E4%B9%88%E5%86%85%E5%AE%B9%E4%B8%8D%E8%A6%81%E5%86%99%E8%BF%9B%E5%8E%BB) 六、什么内容不要写进去？

`CLAUDE.md` 最大的问题不是没人写。

而是很多人越写越长，最后变成项目垃圾场。

以下内容不建议写进去。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_1-%E5%AE%8C%E6%95%B4%E6%8E%A5%E5%8F%A3%E6%96%87%E6%A1%A3) 1\. 完整接口文档

接口字段、返回值、错误码，如果很多，应该放专门文档。

`CLAUDE.md` 里最多写：

```md
- API 文档见 `docs/api.md`
- 修改接口调用前先检查 `src/api/`
```

1

2

不要把几十个接口全贴进去。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_2-%E5%8E%86%E5%8F%B2%E6%B5%81%E6%B0%B4%E8%B4%A6) 2\. 历史流水账

比如：

```md
- 2025-01-03 修了登录问题
- 2025-02-11 重构过首页
- 2025-03-07 和产品讨论过按钮颜色
```

1

2

3

这类信息对当前行动通常没帮助。

如果某个历史决策很重要，要写成规则：

```md
- 登录态统一由 `authStore` 管理，不要在页面组件里重复维护 token。
```

1

别写流水账，写结论。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_3-%E7%A9%BA%E6%B3%9B%E5%8F%A3%E5%8F%B7) 3\. 空泛口号

比如：

```md
- 写高质量代码
- 注意性能
- 保持架构清晰
```

1

2

3

这类话看着正确，但不能指导行动。

改成可执行规则：

```md
- 列表页超过 100 条数据时使用分页，不要一次性渲染全量数据。
- 公共逻辑超过两个页面复用时，抽到 `src/hooks/`。
```

1

2

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_4-%E8%BF%87%E6%9C%9F%E8%A7%84%E5%88%99) 4\. 过期规则

过期规则比没有规则更危险。

比如项目已经从 npm 换成 pnpm，但 `CLAUDE.md` 里还写 npm。

Claude Code 会很听话地继续错。

所以 `CLAUDE.md` 不是写完就不管。

它要随着项目演进更新。

### [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#_5-%E5%A4%AA%E7%BB%86%E7%9A%84%E4%B8%B4%E6%97%B6%E4%BB%BB%E5%8A%A1) 5\. 太细的临时任务

比如：

```md
- 今天先修用户 A 的导出 bug
```

1

这种就不该进项目记忆。

它属于当前对话。

任务结束后还留在 `CLAUDE.md` 里，只会污染后续任务。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%B8%83%E3%80%81%E6%80%8E%E4%B9%88%E5%86%99%E6%89%8D%E7%9C%9F%E7%9A%84%E6%9C%89%E6%95%88) 七、怎么写才真的有效？

我建议录友记住三个词：

**短、准、硬。**

短，是不要写长篇大论。

准，是每条都和行动有关。

硬，是尽量写成明确约束，而不是温柔建议。

比如这句话：

```md
- 尽量注意测试。
```

1

太软。

改成：

```md
- 修改业务逻辑后，必须运行相关测试；如果无法运行，在最终回复说明原因。
```

1

这就好多了。

再比如：

```md
- 代码要符合项目风格。
```

1

太虚。

改成：

```md
- 新增 API 请求必须放在 `src/api/`，页面组件只能调用封装后的 API 方法。
```

1

这才是 Claude Code 能执行的规则。

我会把好 `CLAUDE.md` 的写法分成 6 类：

1. 项目是什么
2. 命令怎么跑
3. 目录怎么分
4. 代码怎么写
5. 什么不能做
6. 改完怎么验

其他内容能不放就不放。

**写 CLAUDE.md，不是为了显得你很懂 AI，而是为了让 AI 少猜。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%85%AB%E3%80%81%E5%A4%A7%E9%A1%B9%E7%9B%AE%E6%80%8E%E4%B9%88%E6%8B%86-claude-md) 八、大项目怎么拆 CLAUDE.md？

小项目一个根 `CLAUDE.md` 就够了。

大项目一定要拆。

尤其是 monorepo。

比如一个项目有：

- Web 前端
- Node 后端
- 移动端
- 文档站
- 基础组件库

如果你把所有规则都写进根 `CLAUDE.md`，最后一定变成十几屏。

Claude Code 每次做一个很小的任务，都要背着一堆无关规则。

更好的结构是：

```text
repo/
  CLAUDE.md
  apps/web/CLAUDE.md
  apps/admin/CLAUDE.md
  packages/ui/CLAUDE.md
  docs/CLAUDE.md
```

1

2

3

4

5

6

根文件写全局规则：

- 包管理器
- Git 流程
- 安全要求
- 全局禁止事项
- 通用验证方式

模块文件写模块规则：

- 当前模块目录职责
- 本模块启动命令
- 本模块测试命令
- 本模块常见坑

这样 Claude Code 在处理具体模块时，拿到的是更相关的上下文。

这和我们前面讲 Agent 上下文管理是同一个逻辑：

**不是让模型看见更多，而是让它看见更有价值的信息。**

![图5：大项目拆分 CLAUDE.md 的核心价值是减少无关规则占用上下文预算](https://file1.kamacoder.com/i/web/20260527112108_claude_md_05_context_budget_compressed.png)

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E4%B9%9D%E3%80%81claude-md-%E5%92%8C%E4%B8%8A%E4%B8%8B%E6%96%87%E7%AA%97%E5%8F%A3%E6%9C%89%E4%BB%80%E4%B9%88%E5%85%B3%E7%B3%BB) 九、CLAUDE.md 和上下文窗口有什么关系？

这里要讲一个很关键的点。

`CLAUDE.md` 虽然好用，但它不是免费空间。

它会进入 Claude Code 的上下文。

上下文窗口就像一张工作台。

你把项目规则放上去，模型就能看到。

但你放太多，工具输出、文件内容、用户要求就会被挤。

所以不要把 `CLAUDE.md` 当成无限记事本。

官方资料里也提到，Claude Code 会对 `CLAUDE.md` 使用 prompt caching。

这能降低重复读取带来的成本。

但录友要注意： **缓存降低的是计费压力，不代表它不占上下文空间，也不代表信息越多越好。**

一份 300 行的 `CLAUDE.md`，即使缓存了，模型每次也要在大量规则里找重点。

这就会带来两个问题：

第一，重要规则被淹没。

第二，无关规则干扰当前任务。

所以我更推荐：

- 根 `CLAUDE.md` 控制在几屏内
- 每条规则尽量一行说明
- 长文档用链接或 import 引用
- 低频规则放到对应子目录
- 定期删除过期内容

**CLAUDE.md 的目标不是大而全，而是让 Claude Code 进入项目后少踩坑。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%8D%81%E3%80%81%E7%BB%99%E4%BD%A0%E4%B8%80%E4%B8%AA%E5%8F%AF%E4%BB%A5%E7%9B%B4%E6%8E%A5%E6%8A%84%E7%9A%84%E6%A8%A1%E6%9D%BF) 十、给你一个可以直接抄的模板

下面这个模板，录友可以直接放到项目根目录，然后按自己项目改。

```md
# 项目工作说明

## 项目概述

- 本项目是一个 XXX 应用，主要技术栈是 XXX。
- 主要代码在 `src/`，测试在 `tests/`。
- 优先遵循现有代码风格，不要引入新的架构风格。

## 常用命令

- 安装依赖：`pnpm install`
- 本地开发：`pnpm dev`
- 单元测试：`pnpm test`
- 构建检查：`pnpm build`

## 目录结构

- `src/components/`：通用组件
- `src/pages/`：页面入口
- `src/api/`：接口封装
- `src/hooks/`：可复用业务逻辑
- `tests/`：测试文件

## 编码规范

- 新增 API 请求必须放在 `src/api/`。
- 页面组件不要直接调用 `fetch`。
- 公共逻辑被两个以上模块复用时，抽到 `src/hooks/`。
- 修改已有功能时，优先保持现有接口兼容。

## 禁止事项

- 不要提交 `.env`、token、密钥。
- 不要升级核心依赖版本，除非用户明确要求。
- 不要修改数据库 schema，除非用户明确要求。
- 不要删除用户已有改动。

## 验证要求

- 修改业务逻辑后，运行相关测试。
- 修改公共组件后，运行构建检查。
- 如果测试无法运行，在最终回复里说明原因。

## 常见坑

- 本项目使用 pnpm，不要使用 npm 或 yarn。
- 修改配置文件后，需要重新启动开发服务器。
- 遇到鉴权问题，先检查 `src/api/auth.ts` 和 `src/store/auth.ts`。
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

23

24

25

26

27

28

29

30

31

32

33

34

35

36

37

38

39

40

41

42

43

44

45

46

47

48

这个模板不是让你照搬到所有项目。

它的价值是结构。

你真正要做的是把里面每一条改成自己项目里的真实规则。

**假的规范，比没有规范更坑。**

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%8D%81%E4%B8%80%E3%80%81%E5%9B%A2%E9%98%9F%E9%87%8C%E6%80%8E%E4%B9%88%E7%BB%B4%E6%8A%A4-claude-md) 十一、团队里怎么维护 CLAUDE.md？

如果团队已经大量使用 AI 编程，我建议把 `CLAUDE.md` 当成工程资产维护。

不要让它变成某个人电脑里的私货。

团队可以这么做：

**第一，项目根 `CLAUDE.md` 进仓库。**

凡是团队共享规则，都应该进 Git。

比如构建命令、目录职责、代码规范、禁止事项。

**第二，个人偏好放用户级 memory。**

比如你喜欢中文回复、喜欢先看计划、喜欢最终说明简短。

这些不应该污染团队项目文件。

**第三，规则变更要像代码一样审查。**

尤其是禁止事项、测试命令、架构规则。

它们会直接影响 AI 的行动。

写错了，就是把错误流程自动化。

**第四，踩坑之后及时沉淀。**

如果 Claude Code 因为某个项目坑连续犯错，不要只在聊天里骂它。

把坑写进 `CLAUDE.md`。

比如：

```md
- 支付模块的金额单位是分，不是元。
```

1

这种一句话，可能能避免很多次错误。

**第五，定期删。**

`CLAUDE.md` 不是只加不删。

每隔一段时间看一眼：

- 有没有过期命令
- 有没有已经不存在的目录
- 有没有重复规则
- 有没有临时任务残留

越短越准，越有用。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%8D%81%E4%BA%8C%E3%80%81%E9%9D%A2%E8%AF%95%E5%92%8C%E5%B7%A5%E4%BD%9C%E4%B8%AD%E6%80%8E%E4%B9%88%E8%AE%B2%E8%BF%99%E4%B8%AA%E8%83%BD%E5%8A%9B) 十二、面试和工作中怎么讲这个能力？

很多人以为会用 Claude Code，就是会让它写代码。

其实更高级一点，是你能把 AI 编程变成稳定流程。

`CLAUDE.md` 就是一个很好的例子。

面试官如果问你："你怎么让 AI 编程工具更稳定？"

你可以这样答：

"我不会只靠临时 prompt 管项目规则。对于跨任务稳定的信息，比如项目架构、常用命令、测试方式、代码风格、禁止改动范围，我会沉淀到 `CLAUDE.md`。这样 Claude Code 每次进入项目时都能读取这些规则，减少重复解释，也减少上下文压缩后丢约束的问题。

但我不会把 `CLAUDE.md` 写成大杂烩。因为它会进入上下文，太长会稀释注意力。所以我会按全局规则和模块规则拆分，根目录写通用约束，子目录写模块细节；临时任务放 prompt，个人偏好放用户级 memory，团队规则放项目级 `CLAUDE.md`。核心目标不是让模型看到更多，而是让它看到更稳定、更有行动价值的信息。"

这个回答就不只是"我会用工具"。

它说明你理解 AI Coding 背后的工程化问题。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E7%BB%93%E5%B0%BE) 结尾

`CLAUDE.md` 不是魔法。

它不会让 Claude Code 瞬间变成懂你公司所有业务的老员工。

但它能解决一个非常实际的问题：

**别让 AI 每次进项目都从零猜。**

项目怎么启动，代码怎么写，哪里不能动，改完怎么验，这些规则越早沉淀，Claude Code 越像一个靠谱队友。

录友们不要把 `CLAUDE.md` 写成百科全书。

就写那些会反复影响行动的规则。

短一点，准一点，硬一点。

这就够了。

## [\#](https://notes.kamacoder.com/llm/claude/claude_md.html\#%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99) 参考资料

- Claude Code Docs：Manage Claude's memory：https://docs.claude.com/en/docs/claude-code/memory)
- Claude Help Center：Give Claude context: CLAUDE.md and better prompts：https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts
- Claude Help Center：Claude Code cheatsheet：https://support.claude.com/en/articles/14553413-claude-code-cheatsheet

←
[Claude Code扩展能力完整指南](https://notes.kamacoder.com/llm/claude/claude_code_toolkit_guide.html)[Claude Code怎么读懂大代码库](https://notes.kamacoder.com/llm/claude/claude_code_large_codebase.html)
→


### 评论

登录后评论登录