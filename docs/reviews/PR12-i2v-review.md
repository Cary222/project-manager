# PR12 — I2V 图生视频功能 审查合并报告

<!-- merged by Main agent -->
<!-- date: 2026-08-13 -->
<!-- scope: PR12 - I2V (Image-to-Video) implementation -->

---

## 审查结论

| 审查 | 结论 | Critical |
|------|------|---------|
| code-reviewer（硬层） | ❌ Request Changes → **已修复** | 1 个，已修复 |
| ai-learning-mentor（软层） | ✅ APPROVED | 1 个，建议 V1.1 修复 |

---

## 硬层审查摘要

### 已修复：Critical 安全漏洞

**`inputFileIds` 缺少归属验证**

任何已登录用户可传入任意 `fileAssetId` 利用他人图片生成视频。已通过 `AiMessageAttachment → AiChatMessage → conversation.userId` 关联路径修复（`AiFileAsset` 无 userId 字段，走多表 join）。同步修复了 `image/route.ts` 的同样问题。

### 已修复：SSE 状态推送

`video.handler.ts` 在 PROCESSING 和 COMPLETED 路径补充了 `emitMessageDelta` 调用，与 `image.handler.ts` 行为一致。

### 通过项

- Schema 设计（`inputFileIds` vs `imageUrl`）
- `resolveGenerationMode` 抽象
- 幂等性检查（`jobOutput.findUnique` → COMPLETED 跳过）
- DATABASE storage 报错处理
- 前端乐观更新

### 待记录（Tech Debt）

- `taskCategory="video"` 命名语义与 I2V 语义不对齐，改为 `supportsReferenceImage` 涉及接口改动，优先级低

---

## 软层审查摘要

### 设计亮点

1. **`inputFileIds` 的选择**：正确抽象层级，为多图/关键帧等扩展留足空间
2. **API/Worker 分层**：职责分离清晰，API 快速失败，Worker 异步执行
3. **`file-source.ts` 的边界处理**：明确 DATABASE 不支持，不伪造 URL
4. **共用 `generation-mode.ts`**：Image/Video 复用校验逻辑

### Critical 问题（建议 V1.1 修复）

**DATABASE storage I2V 用户体验**：`file-source.ts` 对 DATABASE storage 直接抛错，用户只看到"视频生成失败"。

缓解方案：API 层增加 storageType 预检查，Worker 层补充更友好的错误文案。根本解法是实现 OBJECT_STORAGE signed URL（长期）。

### 中等优先级改进点

1. Agnes V2 `num_frames`/`frame_rate` 硬编码 121/24，时长/比例不可配置
2. I2V 进度反馈缺失（无 `emitMessageDelta`，已在本次修复）
3. 历史消息 `userImages` 渲染链路待验证

---

## 质量门

| 门 | 状态 |
|----|------|
| `tsc --noEmit` | ✅ 无新增错误 |
| `npm run build` | ✅ 通过 |
| 安全（归属验证） | ✅ 已修复 |
| SSE 推送 | ✅ 已修复 |

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `app/api/ai/generate/video/route.ts` | Schema 变更、I2V 校验、INPUT 附件、安全归属验证 |
| `app/api/ai/generate/image/route.ts` | 安全归属验证（同步修复） |
| `worker/background/handlers/video.handler.ts` | `resolveGenerationMode`、输入图解析、SSE 推送 |
| `features/ai/ui/AiChatPanel.tsx` | 视频 Tab 参考图上传支持 |
