import { understandQuery } from "../features/ai/search/query-understanding";
import {
  executeRetrievalPlan,
  retrievalContextText,
} from "../features/ai/search/retrieval-router";

async function main() {
  console.log(`\n======================================================`);
  console.log(`🧭 AI 检索路由与意图理解端到端验证`);
  console.log(`======================================================\n`);

  // 场景 1: 光污染设计相关查询 (原 Bug: 匹配"污染"跳去天气)
  const q1 = "光污染设计涉及哪些站内信息";
  console.log(`--- [用例 1] 站内知识查询: "${q1}" ---`);
  const plan1 = understandQuery(q1);
  console.log(`  Scope: ${plan1.scope}`);
  console.log(`  Intent: ${plan1.intent}`);
  console.log(`  Subject: "${plan1.subject}"`);
  console.log(`  RequestedTypes: [${plan1.requestedTypes.join(", ")}]`);
  console.log(`  NeedsWeb: ${plan1.needsWeb}`);
  if (plan1.scope === "INTERNAL_ONLY" && !plan1.needsWeb) {
    console.log(`  ✅ 通过：正确锁定站内范围，未被“污染”关键词误判为天气！`);
  } else {
    console.error(`  ❌ 失败：未锁定站内范围！`);
    process.exit(1);
  }

  // 场景 2: 复合人员+活动查询 (原 Bug: "提交工" 被误判为人名)
  const q2 = "提交工单有哪些规范";
  console.log(`\n--- [用例 2] 复合动词查询: "${q2}" ---`);
  const plan2 = understandQuery(q2);
  console.log(`  Scope: ${plan2.scope}`);
  console.log(`  Intent: ${plan2.intent}`);
  console.log(`  Subject: "${plan2.subject}"`);
  console.log(`  RequestedTypes: [${plan2.requestedTypes.join(", ")}]`);
  if (plan2.intent !== "activity") {
    console.log(
      `  ✅ 通过：没有将“提交工单”切出人名“提交工”，意图非个人活动！`,
    );
  } else {
    console.error(`  ❌ 失败：被误判为个人活动查询！`);
    process.exit(1);
  }

  // 场景 3: 明确人员查询
  const q3 = "刘工最近提交了什么";
  console.log(`\n--- [用例 3] 真实人员活动查询: "${q3}" ---`);
  const plan3 = understandQuery(q3);
  console.log(`  Scope: ${plan3.scope}`);
  console.log(`  Intent: ${plan3.intent}`);
  console.log(`  Subject: "${plan3.subject}"`);
  console.log(`  RequestedTypes: [${plan3.requestedTypes.join(", ")}]`);
  if (plan3.intent === "activity" && plan3.requestedTypes.includes("commit")) {
    console.log(`  ✅ 通过：正确识别为活动查询并包含提交类型！`);
  } else {
    console.error(`  ❌ 失败：未识别为活动查询！`);
    process.exit(1);
  }

  // 场景 4: 外部公网查询
  const q4 = "今天北京天气怎么样";
  console.log(`\n--- [用例 4] 纯外部天气查询: "${q4}" ---`);
  const plan4 = understandQuery(q4);
  console.log(`  Scope: ${plan4.scope}`);
  console.log(`  Intent: ${plan4.intent}`);
  console.log(`  Subject: "${plan4.subject}"`);
  if (plan4.scope === "WEB_ALLOWED" && plan4.intent === "external") {
    console.log(`  ✅ 通过：正确判定为 WEB_ALLOWED + external！`);
  } else {
    console.error(`  ❌ 失败：未能判定为外部查询！`);
    process.exit(1);
  }

  // 场景 5: 验证检索路由与两轮重试机制
  console.log(`\n--- [用例 5] 复合检索路由器执行仿真 ---`);
  let roundCount = 0;
  const mockDeps = {
    structured: async () => [],
    hybrid: async () => [],
    graph: async () => {
      roundCount++;
      if (roundCount === 2) {
        return [
          {
            id: "note_1",
            type: "note" as const,
            title: "光污染技术总结",
            content: "详细内容...",
            url: "/pkm/notes/note_1",
            channel: "graph" as const,
            paths: ["note_1 → ticket_2"],
          },
          {
            id: "proj_1",
            type: "project" as const,
            title: "光污染演示项目",
            content: "项目简介...",
            url: "/projects/proj_1",
            channel: "graph" as const,
          },
          {
            id: "tick_1",
            type: "ticket" as const,
            title: "修复光污染问题",
            content: "工单说明...",
            url: "/tickets/tick_1",
            channel: "graph" as const,
          },
        ];
      }
      return [];
    },
    timeoutMs: 1000,
  };

  const report = await executeRetrievalPlan(plan1, mockDeps);
  console.log(`  一轮是否命中: ${roundCount > 1 ? "否 (已触发重写)" : "是"}`);
  console.log(`  重写状态: ${report.rewritten}`);
  console.log(`  最终证据数量: ${report.evidence.length}`);
  console.log(`  证据是否充分: ${report.enough}`);
  console.log(`  是否放行 Web 搜索: ${report.allowWeb}`);

  if (report.rewritten && report.enough && !report.allowWeb) {
    console.log(
      `  ✅ 通过：第一轮为空时自动触发重写并获得充分证据，站内查询严格封锁 Web 搜索！`,
    );
  } else {
    console.error(`  ❌ 失败：检索路由器逻辑不符合预期！`);
    process.exit(1);
  }

  console.log(`\n----------------------------------------`);
  console.log(`生成的上下文前 200 字展示:`);
  console.log(retrievalContextText(report).slice(0, 200) + "...\n");
  console.log(`🎉 路由与检索全链路验证通过！\n`);
}

main().catch((err) => {
  console.error("验证出错:", err);
  process.exit(1);
});
