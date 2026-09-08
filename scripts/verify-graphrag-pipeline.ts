/**
 * GraphRAG 端到端真实验证脚本 (对照实验)
 *
 * 运行方式：npx tsx scripts/verify-graphrag-pipeline.ts
 */

import { PrismaClient } from "@prisma/client";
import { searchDocuments } from "../features/knowledge/lib/search";
import { retrieveContext, buildRagPrompt } from "../features/ai/search/rag";

async function main() {
  const query = "#10010"; // 真实存在的工单：整理wifi相机云端环境
  console.log(`\n======================================================`);
  console.log(`🔍 GraphRAG 对照实验开始`);
  console.log(`Query: "${query}"`);
  console.log(`======================================================\n`);

  // 1. 对照组 A：传统检索模式 (useGraph: false)
  console.log(`--- [实验组 A] 传统检索 (useGraph: false, 纯关键字 + 向量) ---`);
  const resNaive = await searchDocuments({
    query,
    useGraph: false,
    limit: 5,
  });
  console.log(`召回总数: ${resNaive.total}`);
  for (const item of resNaive.results) {
    console.log(
      `  - [${item.type}] ${item.title} (score: ${item.score.toFixed(3)})`,
    );
    console.log(`    sources: ${item.sources?.join(", ") ?? "keyword/vector"}`);
    console.log(`    paths:   ${item.knowledgePaths?.join(" | ") ?? "无"}`);
  }

  // 2. 实验组 B：GraphRAG 模式 (useGraph: true, 三路 RRF 融合)
  console.log(
    `\n--- [实验组 B] GraphRAG 模式 (useGraph: true, Keyword + Vector + Graph 递归 CTE + RRF) ---`,
  );
  const resGraph = await searchDocuments({
    query,
    useGraph: true,
    viewerRole: "ROOT",
    limit: 5,
  });
  console.log(`召回总数: ${resGraph.total}`);
  for (const item of resGraph.results) {
    console.log(
      `  - [${item.type}] ${item.title} (RRF score: ${item.score.toFixed(4)})`,
    );
    console.log(`    sources: ${item.sources?.join(", ") ?? "none"}`);
    console.log(`    paths:   ${item.knowledgePaths?.join(" | ") ?? "无"}`);
  }

  // 3. 验证 AI RAG Prompt 组装
  console.log(
    `\n--- [链路 C] retrieveContext() 与 buildRagPrompt() 生成检验 ---`,
  );
  const ragContext = await retrieveContext(query, {
    useGraph: true,
    viewerRole: "ROOT",
    limit: 3,
  });

  console.log(
    `AI 上下文包含图谱路径数: ${ragContext.knowledgePaths?.length ?? 0}`,
  );
  if (ragContext.knowledgePaths) {
    console.log(`图谱路径明细:`);
    ragContext.knowledgePaths.forEach((p) => console.log(`  🔗 ${p}`));
  }

  const prompt = buildRagPrompt(query, ragContext);
  console.log(
    `\n最终组装的 Prompt 截取:\n----------------------------------------`,
  );
  console.log(prompt.slice(0, 800));
  console.log(`----------------------------------------\n`);

  console.log(`✅ GraphRAG 端到端验证完成！`);
}

main().catch((err) => {
  console.error("验证失败:", err);
  process.exit(1);
});
