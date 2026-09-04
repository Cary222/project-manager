/**
 * ThinkingStep and related types for the LangGraph pipeline.
 */

import type { AiMode } from "./modes";

export type ThinkingNodeName =
  | "detectIntent"
  | "modelSelect"
  | "searchKnowledge"
  | "searchStructured"
  | "webSearch"
  | "decision"
  | "generateResponse";

export type ThinkingStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "error";

export interface ThinkingStep {
  nodeName: ThinkingNodeName;
  /** 中文展示标签，例如 "意图识别" / "知识检索"。 */
  nodeLabel: string;
  /** 工具英文原名（仅工具节点）。UI 上与中文标签并列展示。 */
  toolName?: "searchKnowledge" | "searchStructured" | "webSearch";
  status: ThinkingStepStatus;
  /** performance.now() 时间戳，进入 running 时记录。 */
  startedAt?: number;
  /** performance.now() 时间戳，进入 done / error 时记录。 */
  endedAt?: number;
  /** 工具原始输出；只对工具节点有效。结构化数据 JSON.stringify 展示，纯文本原样展示。 */
  output?: unknown;
  /** 错误信息（仅 error 状态）。 */
  error?: string;
}

interface NodeTemplate {
  nodeName: ThinkingNodeName;
  nodeLabel: string;
  toolName?: ThinkingStep["toolName"];
}

/**
 * 把"以何种 mode 提问"映射到"应该走哪几个 LangGraph 节点"。
 * NOTE: `generateResponse` 不写在此处 —— 后端 graph 固定在末尾追加。
 * `decision` 是中间节点，写在 search* 之后、generateResponse 之前。
 */
export function buildStepPlan(mode: AiMode): NodeTemplate[] {
  switch (mode) {
    case "search":
      return [
        { nodeName: "detectIntent", nodeLabel: "理解" },
        { nodeName: "modelSelect", nodeLabel: "模型" },
        { nodeName: "searchKnowledge", nodeLabel: "检索", toolName: "searchKnowledge" },
        { nodeName: "searchStructured", nodeLabel: "查询", toolName: "searchStructured" },
        { nodeName: "decision", nodeLabel: "分析" },
        { nodeName: "generateResponse", nodeLabel: "生成" },
      ];
    case "web":
      return [
        { nodeName: "detectIntent", nodeLabel: "理解" },
        { nodeName: "modelSelect", nodeLabel: "模型" },
        { nodeName: "webSearch", nodeLabel: "搜索", toolName: "webSearch" },
        { nodeName: "decision", nodeLabel: "分析" },
        { nodeName: "generateResponse", nodeLabel: "生成" },
      ];
    case "chat":
      return [
        { nodeName: "detectIntent", nodeLabel: "理解" },
        { nodeName: "modelSelect", nodeLabel: "模型" },
        { nodeName: "generateResponse", nodeLabel: "生成" },
      ];
    case "auto":
    default:
      return [
        { nodeName: "detectIntent", nodeLabel: "理解" },
        { nodeName: "modelSelect", nodeLabel: "模型" },
        { nodeName: "searchKnowledge", nodeLabel: "检索", toolName: "searchKnowledge" },
        { nodeName: "searchStructured", nodeLabel: "查询", toolName: "searchStructured" },
        { nodeName: "decision", nodeLabel: "分析" },
        { nodeName: "generateResponse", nodeLabel: "生成" },
      ];
  }
}
