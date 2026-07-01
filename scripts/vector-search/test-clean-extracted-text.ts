/**
 * 调试脚本：验证附件提取文本的清洗效果（cleanExtractedTextForEmbedding）
 *
 * 用法：
 *   npx tsx scripts/test-clean-extracted-text.ts
 *
 * 从数据库捞所有含附件的 PKM 笔记，对每个附件：
 * 1. 调 /extract-text 拿原始文本
 * 2. 调 cleanExtractedTextForEmbedding 看清洗结果
 * 3. 打印 before/after 对比 + size 变化
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { extractAttachmentTexts } from "@/shared/lib/search";
import { cleanExtractedTextForEmbedding } from "@/shared/lib/markdown";

loadEnvConfig(process.cwd());

async function main() {
  console.log("=== 附件文本清洗效果验证 ===\n");

  const notes = await prisma.pkmNote.findMany({
    include: {
      user: { select: { name: true, email: true } },
      project: { select: { name: true } },
    },
  });

  const notesWithAttachments = notes.filter((n) => {
    try {
      const raw = n.attachments;
      return Array.isArray(raw) && raw.length > 0;
    } catch {
      return false;
    }
  });

  if (notesWithAttachments.length === 0) {
    console.log("没有含附件的笔记，退出。");
    return;
  }

  console.log(`找到 ${notesWithAttachments.length} 条含附件的笔记。\n`);

  for (const note of notesWithAttachments) {
    console.log(`--- 笔记: ${note.title} (${note.id}) ---`);
    const attachments = note.attachments as import("@/shared/lib/pkm").FileAttachment[] ?? [];

    for (const att of attachments) {
      if (!att.fileId) continue; // skip legacy format without fileId
      process.stdout.write(`  [${att.name}] 提取中... `);

      // 调客户端提取
      const result = await (async () => {
        const { extractAttachmentText } = await import("@/shared/lib/search");
        return extractAttachmentText(att);
      })();

      if (!result.text) {
        console.log(`跳过 (source=${result.source})\n`);
        continue;
      }

      // 清洗
      const cleaned = cleanExtractedTextForEmbedding(result.text);

      const beforeSize = result.text.length;
      const afterSize = cleaned.length;
      const reduction = beforeSize > 0
        ? ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
        : "0.0";

      console.log(
        `\n    原始长度: ${beforeSize} chars  |  清洗后: ${afterSize} chars  |  减少: ${reduction}%`
      );

      // 只在有 base64 残留或大段空白时才打印详情
      const hasBase64 = /data:image\/[^;\s]+;[^\s,)]+/i.test(result.text);
      const hasControlChars = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFEFF]/.test(result.text);
      const hasLongBlankLines = /\n{4,}/.test(result.text);

      if (hasBase64) {
        console.log(`    ⚠  检测到 data:image base64 残留（已清除）`);
      }
      if (hasControlChars) {
        console.log(`    ⚠  检测到控制字符/零宽字符（已清除）`);
      }
      if (hasLongBlankLines) {
        console.log(`    ⚠  检测到连续 4+ 换行（已规范化）`);
      }

      // 打印前 300 和后 200 字符
      console.log(`\n    [清洗前 前300字符]`);
      console.log(`    ${result.text.slice(0, 300).replace(/\n/g, "\\n")}`);
      if (result.text.length > 300) {
        console.log(`    ... (省略 ${result.text.length - 600} 字符) ...`);
        console.log(`    [清洗前 后200字符]`);
        console.log(`    ${result.text.slice(-200).replace(/\n/g, "\\n")}`);
      }
      console.log(`\n    [清洗后 前300字符]`);
      console.log(`    ${cleaned.slice(0, 300).replace(/\n/g, "\\n")}`);
      if (cleaned.length > 300) {
        console.log(`    ... (省略 ${cleaned.length - 500} 字符) ...`);
        console.log(`    [清洗后 后200字符]`);
        console.log(`    ${cleaned.slice(-200).replace(/\n/g, "\\n")}`);
      }
      console.log();
    }
  }

  console.log("=== 验证完成 ===");
}

main().catch((err) => {
  console.error("脚本执行出错:", err);
  process.exit(1);
});
