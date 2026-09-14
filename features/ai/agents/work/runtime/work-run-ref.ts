import {
  isUserActivityQuery,
  stripLeadInVerbs,
} from "@/features/ai/core/resolvers/query-parser";

export type WorkRunRef =
  | {
      kind: "project_progress";
      source: "WorkflowRun";
      sourceId: string;
      status: string;
      title: string;
      updatedAt: string;
    }
  | {
      kind: "weekly_report";
      source: "WorkflowRun";
      sourceId: string;
      status: string;
      title: string;
      updatedAt: string;
    }
  | {
      kind: "meeting_minutes";
      source: "ProjectMeeting";
      sourceId: string;
      status: string;
      title: string;
      updatedAt: string;
      projectId?: string;
    }
  | {
      kind: "coding";
      source: "PiSessionOwnership";
      sourceId: string;
      status: string;
      title: string;
      updatedAt: string;
    }
  | {
      kind: "planning";
      source: "WorkflowRun";
      sourceId: string;
      status: string;
      title: string;
      updatedAt: string;
      conversationId?: string | null;
    };

export type WorkRoute = WorkRunRef["kind"];

/**
 * 智能分诊 Work 模式的目标路由（Multi-Tier Cascading Router）
 *
 * 遵循大厂 AI SaaS 意图识别与预处理规范：
 * 1. 预处理：清洗口语化前导词（stripLeadInVerbs）
 * 2. 确定性业务规则分级：
 *    - 显式周报类（周报、周总结、生成周报）-> weekly_report
 *    - 显式会议纪要类（会议、纪要、录音转写）-> meeting_minutes
 *    - 显式进展大盘与人员工作动态回顾（如"我上周干了什么"、"最近做了什么"）-> project_progress
 * 3. 代码任务判定（Coding Task）：
 *    - 显式工单关联（#10001 / ticket）
 *    - 显式代码动作（修bug、修复、实现、重构、编写代码、依赖分析、插件检查等）
 * 4. 智能兜底：
 *    - 纯疑问/查询类问句倾向于 project_progress
 *    - 其余执行操作类归入 coding
 */
export function routeWorkGoal(goal: string): WorkRoute {
  const cleaned = stripLeadInVerbs(goal.trim());
  const normalized = cleaned.toLowerCase();

  // 1. 周报工作流：显式周报或周总结
  if (/周报|weekly|一周(?:工作)?总结|工作周总结/.test(normalized)) {
    return "weekly_report";
  }

  // 2. 会议纪要工作流：会议、例会、纪要、录音、音频转写
  if (/会议|纪要|例会|周会|录音|音频|meeting/.test(normalized)) {
    return "meeting_minutes";
  }
  // 3. 自主规划与分析复盘类（Planning）：
  // 包含明确的规划、方案制定、归因复盘、跨步分析
  if (
    /规划|计划|拆解|复盘|方案|整改|调研|评估/.test(normalized) ||
    /统计.*(?:分析|归因|原因|报告|复盘|方案)/.test(normalized) ||
    /分析.*(?:归因|原因|趋势|报告|复盘|整改)/.test(normalized)
  ) {
    return "planning";
  }

  // 4. 项目进展与工作动态大盘：
  // 包含显式进展关键词，或命中人员活动/产出回顾（如"我上周干了什么"、"最近做了什么"）
  if (
    /进展|进度|概况|大盘|活跃工单|project[-_ ]?progress|progress/.test(
      normalized,
    ) ||
    /(?:项目|团队|当前).{0,6}(?:汇总|统计)/.test(normalized) ||
    isUserActivityQuery(cleaned) ||
    /(?:上周|本周|最近|近期|昨天).{0,10}(?:干了|做了|完成|产出|开发|工作)/.test(
      normalized,
    )
  ) {
    return "project_progress";
  }

  // 5. 代码任务（Coding Task）：
  // 具备明确的代码、缺陷修复、工程开发、工具插件等特征
  if (
    /#\d+|工单\s*#?\d+|bug|缺陷|报错|代码|code|coding|修复|实现|重构|开发|插件|组件|依赖|架构|终端|bash|git/i.test(
      normalized,
    )
  ) {
    return "coding";
  }

  // 6. 兜底分流：
  // 纯疑问词/查询句（“什么”、“有哪些”、“如何”、“怎样”）归为进展/信息汇总，其余归入通用 Planning 执行
  if (/(?:什么|有哪些|怎么样|如何|怎样|详情|在哪)/.test(normalized)) {
    return "project_progress";
  }

  return "planning";
}
