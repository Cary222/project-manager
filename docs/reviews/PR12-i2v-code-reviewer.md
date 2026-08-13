<!-- reviewer: code-reviewer (硬层) -->

## Code Review Summary

**Scope:** PR12-I2V (Image-to-Video) 涉及的文件
**Review Type:** Local Changes（基于 git diff + 审查范围文件）

### Verdict: ❌ Request Changes

### Findings

#### Critical (Must Fix)

- **`app/api/ai/generate/video/route.ts:42-51`** — `inputFileIds` 缺少归属验证（安全漏洞）
  - Impact: 任何已登录用户可传入任意其他用户的 `fileAssetId`，在 I2V 模式下利用他人图片生成视频（隐私泄露 + 资源滥用）。
  - 代码：
    ```ts
    const inputFiles = await prisma.aiFileAsset.findMany({
      where: { id: { in: inputFileIds } },  // ❌ 缺少 userId 过滤
    });
    ```
  - Suggestion: 添加 `userId: session.user.id` 到 where 条件：
    ```ts
    const inputFiles = await prisma.aiFileAsset.findMany({
      where: {
        id: { in: inputFileIds },
        userId: session.user.id,  // ✅ 加归属校验
      },
    });
    ```

- **`app/api/ai/generate/image/route.ts:43-51`** — I2I 路由存在同样的安全漏洞（同类问题）
  - Impact: 同上，I2I 路由同样允许用户访问他人文件。
  - Suggestion: 同上，添加 `userId` 过滤。本 PR 应一并修复（两组路由同步变更）。

#### Improvements (Recommended)

- **`worker/background/handlers/video.handler.ts:74`** — I2V Worker 缺少 SSE 状态推送
  - Reason: `image.handler.ts` 在 PROCESSING / COMPLETED / FAILED 时均调用 `emitMessageDelta`，但 `video.handler.ts` 只在 catch 块 throw 前调用了一次（`emitMessageDelta(messageId, { executionStatus: "FAILED" })`）。导致前端轮询在任务进行中时看不到 PROCESSING 状态更新，只能靠轮询 DB 的 executionStatus 轮询到终态。
  - Suggestion: 在 PROCESSING（行98）和 COMPLETED（行189）前补充 `emitMessageDelta` 调用，与 `image.handler.ts` 保持一致：
    ```ts
    // 行98前
    emitMessageDelta(messageId, {
      executionStatus: "PROCESSING",
      progress: { step: "calling_model", percent: 0, detail: "正在调用视频生成模型..." },
    });
    // 行189前
    emitMessageDelta(messageId, { executionStatus: "COMPLETED" });
    ```

- **`features/ai/ui/AiChatPanel.tsx:1673-1675`** — `taskCategory="video"` 命名语义与 I2V 语义不对齐
  - Reason: `taskCategory` 在 I2V 场景下控制参考图上传 UI，但 "video" 模式字面不传达"图生视频需要输入图"这层语义。当前实现正确，但变量名可能误导后续维护者认为 video 模式不需要图片。
  - Suggestion: 可选重构——将 `taskCategory` 改为 `supportsReferenceImage?: boolean` 或将 `"video"` 值改为 `"i2v"`；但由于改动涉及 `AiChatInput` 接口和下行调用，优先级低。可作为 tech debt 记录。

- **`features/ai/routing/generation-mode.ts:18`** — `resolveGenerationMode` 返回类型过宽
  - Reason: `video` 分支返回 `"IMAGE_TO_VIDEO" | "TEXT_TO_VIDEO"`，但类型声明为 `GenerationMode`（含图生图模式），调用方若不做收窄判断可能在 I2I 场景误传 video 参数。
  - Suggestion: 函数内部 `return hasImages ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";` 已经正确，但可考虑用 `assertion` 缩小返回类型以获得更好的类型推断：
    ```ts
    return hasImages ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO") as VideoGenerationMode;
    ```

#### Nitpicks (Optional)

- **`worker/background/handlers/video.handler.ts:60`** — `inputFileIds[0]` 无长度保护
  - Reason: 虽然行33/行60外层已有 `if (inputFileIds)` 保护，但 `inputFileIds[0]` 理论上在空数组时不会走到这个分支。防御性更好。
  - Suggestion: 添加 `if (!inputFileIds || inputFileIds.length === 0) return;`

- **`app/api/ai/generate/video/route.ts:135`** — console.log 中有 `generationMode` 但 I2I 参考路由没有
  - Reason: 无安全影响，属 debug 额外信息。保留亦可，与 I2V 调试需求匹配。

### Positive Points

- Schema 变更（`imageUrl` → `inputFileIds`）设计合理，与 I2I 路由共享同一套文件 ID 体系，扩展性好。
- `resolveGenerationMode` 抽象层抽取到位，I2V 和 I2I 路由均复用同一函数，职责清晰。
- I2V Worker 的幂等性检查（`jobOutput.findUnique` → COMPLETED 则跳过）实现正确，crash 重试不会重复提交任务。
- Worker 对 `inputFileIds` 的类型守卫和 DATABASE storage 报错处理符合 `file-source.ts` 的约束。
- 前端乐观更新（optimistic user message + loading placeholder）和 5 分钟超时配置合理。
- 模式切换清空参考图的 `useEffect` 逻辑正确，只清非 image/video 模式。

### Cross-Mentor Notes

- `cross-mentor:` `taskCategory="video"` 的 UX 命名问题（见 Improvement #2）涉及前端语义一致性，建议 ai-learning-mentor 在软层审查中评估是否需要改名为 `supportsReferenceImage` 或 `inputMode`。

### Next Steps

1. **必须修复**：`app/api/ai/generate/video/route.ts` 和 `app/api/ai/generate/image/route.ts` 添加 `userId` 归属校验（Critical #1）。
2. **建议修复**：补充 `video.handler.ts` 的 SSE 状态推送（Improvement #1），提升实时体验。
3. **可选**：tech debt 记录 `taskCategory` 语义重命名。
