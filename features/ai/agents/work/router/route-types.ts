export type PiCommandKey = "plan" | "goal" | "review" | "reach" | "websearch";

export interface PiCapability {
  key: PiCommandKey;
  name: string;
  command: string;
  description: string;
}

export interface RoutePlanStep {
  index: number;
  key: PiCommandKey;
  title: string;
  command: string;
  prompt: string;
}

export interface RoutePreflightResult {
  title: string;
  bestRouteText: string;
  bestRouteSteps: string[];
  availableCapabilities: PiCapability[];
  selectedCommandKeys: PiCommandKey[];
  steps: RoutePlanStep[];
  confidence: string;
  rawText: string;
}

export const ALL_PI_CAPABILITIES: PiCapability[] = [
  {
    key: "plan",
    name: "方案规划",
    command: "/plannotator-plan-mode",
    description: "只读分析架构、梳理依赖与制定实施规范",
  },
  {
    key: "goal",
    name: "目标交付",
    command: "/goal",
    description: "多轮迭代编码、自动修复并推进任务直至完成",
  },
  {
    key: "review",
    name: "合规与质量审计",
    command: "/plannotator-review",
    description: "独立 Auditor 审查代码质量、过度设计与安全合规性",
  },
  {
    key: "reach",
    name: "影响分析",
    command: "/reach",
    description: "评估改动涉及的文件树、下游依赖与回归测试范围",
  },
  {
    key: "websearch",
    name: "资料检索",
    command: "/websearch",
    description: "检索外部文档、库规范与最佳实践",
  },
];
