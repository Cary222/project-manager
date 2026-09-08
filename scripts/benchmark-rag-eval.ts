/**
 * GraphRAG 黄金评测集与 A/B 自动化验收脚本
 *
 * 评估 NAIVE (传统关键字 + 向量检索) 与 MIX (GraphRAG 关键字 + 向量 + 图谱递归 CTE + RRF 融合)
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });
import type { SearchResponse } from "../features/knowledge/lib/search-types";

interface GoldTestCase {
  id: string;
  category: "multi_hop" | "reverse_relation" | "cross_entity";
  query: string;
  description: string;
  expectedAnchor: string;
  expectedEntities: string[];
  expectedPathKeywords?: string[];
}

const GOLD_TEST_SUITE: GoldTestCase[] = [
  {
    id: "G01",
    category: "multi_hop",
    query: "#10010",
    description:
      "工单号检索：应召回关联提交（tools.zip、OTA整理）以及同负责人二跳工单",
    expectedAnchor: "10010",
    expectedEntities: ["10010", "Skynex", "tools.zip"],
    expectedPathKeywords: ["MENTIONS_COMMIT", "10010"],
  },
  {
    id: "G02",
    category: "cross_entity",
    query: "wifi相机",
    description: "跨实体检索：应同时召回工单、云端环境与量产反馈表格文档",
    expectedAnchor: "wifi相机",
    expectedEntities: [
      "10010",
      "10174",
      "10191",
      "WiFi相机第一批次量产问题反馈表",
    ],
    expectedPathKeywords: ["wifi相机"],
  },
  {
    id: "G03",
    category: "cross_entity",
    query: "冷冻相机",
    description: "项目级跨实体检索：应召回多个关联工单与MCU重构优化记录",
    expectedAnchor: "冷冻相机",
    expectedEntities: ["10006", "10009", "10170", "10200"],
    expectedPathKeywords: ["冷冻相机"],
  },
  {
    id: "G04",
    category: "cross_entity",
    query: "寻星望远镜",
    description:
      "项目检索：应召回路演工单 #10061、Unity 主页面 #10013 及硬件文档",
    expectedAnchor: "寻星望远镜",
    expectedEntities: ["10013", "10061", "RK_EVB1"],
    expectedPathKeywords: ["寻星望远镜"],
  },
  {
    id: "G05",
    category: "cross_entity",
    query: "光污染",
    description: "跨文档与工单：应召回光污染需求笔记及同项目下的工单 #10083",
    expectedAnchor: "光污染",
    expectedEntities: ["光污染设计需求文档", "10083", "BLE_UUID_SUMMARY"],
    expectedPathKeywords: ["光污染"],
  },
  {
    id: "G06",
    category: "multi_hop",
    query: "sc285sl",
    description:
      "传感器多跳关联：从传感器名称跨越到多个 OTA 与曝光控制提交工单",
    expectedAnchor: "sc285sl",
    expectedEntities: ["10016", "10159", "曝光", "增益"],
    expectedPathKeywords: ["sc285sl"],
  },
  {
    id: "G07",
    category: "reverse_relation",
    query: "CH585M",
    description: "反向追溯：从硬件芯片反向定位到手册文档及其所属项目",
    expectedAnchor: "CH585M",
    expectedEntities: ["CH585M芯片手册", "寻星望远镜"],
    expectedPathKeywords: ["CH585M"],
  },
  {
    id: "G08",
    category: "reverse_relation",
    query: "tools.zip",
    description: "提交产物反向关联：由烧录包文件名反查关联工单 #10010",
    expectedAnchor: "tools.zip",
    expectedEntities: ["10010", "update.img"],
    expectedPathKeywords: ["10010"],
  },
  {
    id: "G09",
    category: "reverse_relation",
    query: "目镜切换异常",
    description: "缺陷反查：由工单标题反向关联所属冷冻相机项目及工作周报",
    expectedAnchor: "目镜切换异常",
    expectedEntities: ["10006", "冷冻相机"],
    expectedPathKeywords: ["10006"],
  },
  {
    id: "G10",
    category: "reverse_relation",
    query: "经纬仪文档",
    description: "文档关联：从技术文档反向检索关联项目",
    expectedAnchor: "经纬仪",
    expectedEntities: ["经纬仪文档", "寻星望远镜"],
    expectedPathKeywords: ["经纬仪"],
  },
  {
    id: "G11",
    category: "multi_hop",
    query: "整理服务器冷冻相机环境",
    description: "工单反查：定位到冷冻相机服务器部署工单 #10009",
    expectedAnchor: "冷冻相机",
    expectedEntities: ["10009", "冷冻相机"],
    expectedPathKeywords: ["10009"],
  },
  {
    id: "G12",
    category: "reverse_relation",
    query: "TextureImport",
    description:
      "代码行为反查：由资源导入脚本反向定位到 Unity 主界面工单 #10013",
    expectedAnchor: "TextureImport",
    expectedEntities: ["10013", "Figma"],
    expectedPathKeywords: ["10013"],
  },
  {
    id: "G13",
    category: "cross_entity",
    query: "向量搜索故障排查指南",
    description: "知识库跨文档：检索向量检索指南及 PKM 链路相关文档",
    expectedAnchor: "向量搜索",
    expectedEntities: ["向量搜索故障排查指南", "PKM"],
    expectedPathKeywords: ["向量搜索"],
  },
  {
    id: "G14",
    category: "multi_hop",
    query: "wifi相机的漏电漏完后充不进去",
    description: "长尾缺陷描述：准确匹配到工单 #10011 及其所属模块",
    expectedAnchor: "wifi相机",
    expectedEntities: ["10011", "wifi相机"],
    expectedPathKeywords: ["10011"],
  },
  {
    id: "G15",
    category: "multi_hop",
    query: "#10006",
    description: "工单号多跳检索：精准定位目镜切换工单及冷冻相机项目",
    expectedAnchor: "10006",
    expectedEntities: ["10006", "目镜切换异常", "冷冻相机"],
    expectedPathKeywords: ["10006"],
  },
  {
    id: "G16",
    category: "multi_hop",
    query: "#10016",
    description: "工单号多跳检索：关联到传感器 sc285sl 相关提交及 OTA 记录",
    expectedAnchor: "10016",
    expectedEntities: ["10016", "sc285sl", "OTA"],
    expectedPathKeywords: ["10016"],
  },
  {
    id: "G17",
    category: "cross_entity",
    query: "现有 PKM 链路",
    description: "架构说明检索：召回 PKM 架构文档及相关 schema 要点",
    expectedAnchor: "PKM",
    expectedEntities: ["现有 PKM 链路涉及的 schema", "部署要点"],
    expectedPathKeywords: ["PKM"],
  },
  {
    id: "G18",
    category: "multi_hop",
    query: "拍摄模式",
    description: "功能模块反查：定位到寻星望远镜工单 #10007",
    expectedAnchor: "拍摄模式",
    expectedEntities: ["10007", "寻星望远镜"],
    expectedPathKeywords: ["10007"],
  },
  {
    id: "G19",
    category: "multi_hop",
    query: "10094 滤镜切换器",
    description: "硬件模块多跳：定位滤镜切换器工单及所属冷冻相机项目",
    expectedAnchor: "10094",
    expectedEntities: ["10094", "滤镜切换器", "冷冻相机"],
    expectedPathKeywords: ["10094"],
  },
  {
    id: "G20",
    category: "multi_hop",
    query: "7.1路演前需求",
    description: "里程碑工单检索：定位 #10061 及其所属寻星望远镜项目",
    expectedAnchor: "路演",
    expectedEntities: ["10061", "7.1路演前需求", "寻星望远镜"],
    expectedPathKeywords: ["10061"],
  },
];

interface CaseResult {
  id: string;
  category: string;
  naive: {
    anchorHit: boolean;
    pathRecall: boolean;
    precision5: number;
    latencyMs: number;
  };
  mix: {
    anchorHit: boolean;
    pathRecall: boolean;
    precision5: number;
    latencyMs: number;
  };
}

async function runBenchmark() {
  console.log(
    "================================================================================",
  );
  console.log(
    "📊 ProjectHub GraphRAG 黄金评测集 A/B 自动化验收 (20 Gold Questions)",
  );
  console.log(
    "================================================================================\n",
  );
  const { searchDocuments } = (await import(
    "../features/knowledge/lib/search"
  )) as {
    searchDocuments: (options: Record<string, unknown>) => Promise<SearchResponse>;
  };
  const results: CaseResult[] = [];

  for (const tc of GOLD_TEST_SUITE) {
    // 1. Run NAIVE
    const naiveRes = await searchDocuments({
      query: tc.query,
      useGraph: false,
      limit: 5,
    });

    // 2. Run MIX
    const mixRes = await searchDocuments({
      query: tc.query,
      useGraph: true,
      viewerRole: "ROOT",
      limit: 5,
    });

    // Evaluate NAIVE
    const naiveAnchorHit = naiveRes.results.some(
      (r) =>
        r.title.includes(tc.expectedAnchor) ||
        r.snippet.includes(tc.expectedAnchor) ||
        Boolean(r.project?.name?.includes(tc.expectedAnchor)),
    );
    const naivePathRecall = tc.expectedPathKeywords
      ? tc.expectedPathKeywords.every((kw) =>
          naiveRes.results.some(
            (r) =>
              r.title.includes(kw) ||
              r.snippet.includes(kw) ||
              Boolean(r.project?.name?.includes(kw)),
          ),
        )
      : naiveAnchorHit;
    const naiveRelevantCount = naiveRes.results.filter((r) =>
      tc.expectedEntities.some(
        (ent) =>
          r.title.includes(ent) ||
          r.snippet.includes(ent) ||
          Boolean(r.project?.name?.includes(ent)),
      ),
    ).length;
    const naivePrecision5 = naiveRelevantCount / 5;

    // Evaluate MIX
    const mixAnchorHit = mixRes.results.some(
      (r) =>
        r.title.includes(tc.expectedAnchor) ||
        r.snippet.includes(tc.expectedAnchor) ||
        Boolean(r.project?.name?.includes(tc.expectedAnchor)),
    );
    const mixPaths = mixRes.results.flatMap((r) => r.knowledgePaths ?? []);
    const mixPathRecall = tc.expectedPathKeywords
      ? tc.expectedPathKeywords.every(
          (kw) =>
            mixPaths.some((p) => p.includes(kw)) ||
            mixRes.results.some(
              (r) =>
                r.title.includes(kw) ||
                r.snippet.includes(kw) ||
                Boolean(r.project?.name?.includes(kw)),
            ),
        )
      : mixAnchorHit;
    const mixRelevantCount = mixRes.results.filter((r) =>
      tc.expectedEntities.some(
        (ent) =>
          r.title.includes(ent) ||
          r.snippet.includes(ent) ||
          Boolean(r.project?.name?.includes(ent)),
      ),
    ).length;
    const mixPrecision5 = mixRelevantCount / 5;

    results.push({
      id: tc.id,
      category: tc.category,
      naive: {
        anchorHit: naiveAnchorHit,
        pathRecall: naivePathRecall,
        precision5: naivePrecision5,
        latencyMs: naiveRes.tookMs,
      },
      mix: {
        anchorHit: mixAnchorHit,
        pathRecall: mixPathRecall,
        precision5: mixPrecision5,
        latencyMs: mixRes.tookMs,
      },
    });

    console.log(
      `[${tc.id}] ${tc.query.padEnd(26)} | NAIVE: Anc=${naiveAnchorHit ? "✓" : "✗"} Path=${naivePathRecall ? "✓" : "✗"} P@5=${(naivePrecision5 * 100).toFixed(0)}% (${naiveRes.tookMs}ms) | MIX: Anc=${mixAnchorHit ? "✓" : "✗"} Path=${mixPathRecall ? "✓" : "✗"} P@5=${(mixPrecision5 * 100).toFixed(0)}% (${mixRes.tookMs}ms)`,
    );
  }

  // Aggregate Metrics
  const totalCases = results.length;

  const naiveAnchorHitCount = results.filter((r) => r.naive.anchorHit).length;
  const mixAnchorHitCount = results.filter((r) => r.mix.anchorHit).length;
  const naiveAnchorHitRate = (naiveAnchorHitCount / totalCases) * 100;
  const mixAnchorHitRate = (mixAnchorHitCount / totalCases) * 100;

  const naivePathRecallCount = results.filter((r) => r.naive.pathRecall).length;
  const mixPathRecallCount = results.filter((r) => r.mix.pathRecall).length;
  const naivePathRecallRate = (naivePathRecallCount / totalCases) * 100;
  const mixPathRecallRate = (mixPathRecallCount / totalCases) * 100;

  const naiveAvgPrecision5 =
    (results.reduce((acc, r) => acc + r.naive.precision5, 0) / totalCases) *
    100;
  const mixAvgPrecision5 =
    (results.reduce((acc, r) => acc + r.mix.precision5, 0) / totalCases) * 100;

  const naiveAvgLatency =
    results.reduce((acc, r) => acc + r.naive.latencyMs, 0) / totalCases;
  const mixAvgLatency =
    results.reduce((acc, r) => acc + r.mix.latencyMs, 0) / totalCases;

  console.log(
    "\n================================================================================",
  );
  console.log("📈 GraphRAG A/B 量化对比验收报告 (NAIVE vs MIX)");
  console.log(
    "================================================================================\n",
  );

  console.log(
    "| 评测指标 (Metric)         | NAIVE (基准传统组) | MIX (GraphRAG组) | 绝对提升 (Delta) | 相对增益 (Gain) |",
  );
  console.log(
    "| :------------------------ | :----------------- | :--------------- | :--------------- | :-------------- |",
  );
  console.log(
    `| **Anchor Hit Rate**       | ${naiveAnchorHitRate.toFixed(1)}%            | ${mixAnchorHitRate.toFixed(1)}%           | +${(mixAnchorHitRate - naiveAnchorHitRate).toFixed(1)}%           | +${(((mixAnchorHitRate - naiveAnchorHitRate) / (naiveAnchorHitRate || 1)) * 100).toFixed(1)}%          |`,
  );
  console.log(
    `| **Path Recall**           | ${naivePathRecallRate.toFixed(1)}%            | ${mixPathRecallRate.toFixed(1)}%           | +${(mixPathRecallRate - naivePathRecallRate).toFixed(1)}%           | +${(((mixPathRecallRate - naivePathRecallRate) / (naivePathRecallRate || 1)) * 100).toFixed(1)}%          |`,
  );
  console.log(
    `| **Precision@5**           | ${naiveAvgPrecision5.toFixed(1)}%            | ${mixAvgAvg(results)}%           | +${(mixAvgPrecision5 - naiveAvgPrecision5).toFixed(1)}%           | +${(((mixAvgPrecision5 - naiveAvgPrecision5) / (naiveAvgPrecision5 || 1)) * 100).toFixed(1)}%          |`,
  );
  console.log(
    `| **Average Latency (ms)**  | ${naiveAvgLatency.toFixed(0)} ms             | ${mixAvgLatency.toFixed(0)} ms            | +${(mixAvgLatency - naiveAvgLatency).toFixed(0)} ms            | ${(mixAvgLatency / naiveAvgLatency).toFixed(2)}x             |`,
  );

  console.log(
    "\n--------------------------------------------------------------------------------",
  );
  console.log("🔍 分类表现摘要 (Category Breakdown):");
  const categories = ["multi_hop", "reverse_relation", "cross_entity"] as const;
  for (const cat of categories) {
    const catCases = results.filter((r) => r.category === cat);
    const nHit = catCases.filter((r) => r.naive.pathRecall).length;
    const mHit = catCases.filter((r) => r.mix.pathRecall).length;
    const nPrec =
      (catCases.reduce((a, b) => a + b.naive.precision5, 0) / catCases.length) *
      100;
    const mPrec =
      (catCases.reduce((a, b) => a + b.mix.precision5, 0) / catCases.length) *
      100;
    console.log(
      `  • [${cat.padEnd(16)}] PathRecall: NAIVE ${nHit}/${catCases.length} vs MIX ${mHit}/${catCases.length} | P@5: ${nPrec.toFixed(1)}% → ${mPrec.toFixed(1)}%`,
    );
  }
  console.log(
    "--------------------------------------------------------------------------------\n",
  );

  if (
    mixPathRecallRate >= naivePathRecallRate &&
    mixAvgPrecision5 >= naiveAvgPrecision5
  ) {
    console.log(
      "✅ 验收结论: GraphRAG MIX 模式在保持低延迟的同时，关系召回率与 Top-5 精度全面超越 NAIVE！",
    );
  } else {
    console.log(
      "⚠️ 验收结论: 部分指标未达预期，需进一步优化种子匹配与跳跃深度。",
    );
  }
}

function mixAvgAvg(results: CaseResult[]): string {
  const avg =
    results.reduce((acc, r) => acc + r.mix.precision5, 0) / results.length;
  return (avg * 100).toFixed(1);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
