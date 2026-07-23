export type AiMode = "auto" | "search" | "chat" | "web";

export interface AiModeOption {
  key: AiMode;
  label: string;
  icon: string;
  description: string;
}

export const AI_MODE_OPTIONS: AiModeOption[] = [
  {
    key: "auto",
    label: "自动",
    icon: "sparkles",
    description: "智能检测问题类型，自动选择最佳模式",
  },
  {
    key: "search",
    label: "知识检索",
    icon: "search",
    description: "强制搜索知识库，获取准确的项目相关信息",
  },
  {
    key: "chat",
    label: "通用对话",
    icon: "message",
    description: "纯聊天模式，不检索知识库，快速响应",
  },
  {
    key: "web",
    label: "联网搜索",
    icon: "globe",
    description: "联网搜索最新信息，结合知识库回答",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Thinking trace: per-node progress for the LangGraph pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LangGraph 节点名（与 graph/agent.ts 对齐）。
 * `toolName` 仅当节点是工具节点（searchKnowledge / searchStructured / webSearch）
 * 时填写，其它节点（detectIntent / generateResponse）走 LLM 直接产出。
 */
export type ThinkingNodeName =
  | "detectIntent"
  | "searchKnowledge"
  | "searchStructured"
  | "webSearch"
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
 * SSE 实际触发的 tool 节点可能少于模板（比如 chat 模式下 detectIntent 直接
 * 路由到 generateResponse），未触发的节点 UI 上渲染为 `skipped`。
 */
export function buildStepPlan(mode: AiMode): NodeTemplate[] {
  switch (mode) {
    case "search":
      return [
        { nodeName: "detectIntent", nodeLabel: "意图识别" },
        { nodeName: "searchKnowledge", nodeLabel: "知识检索", toolName: "searchKnowledge" },
        { nodeName: "searchStructured", nodeLabel: "数据库查询", toolName: "searchStructured" },
        { nodeName: "generateResponse", nodeLabel: "生成回答" },
      ];
    case "web":
      return [
        { nodeName: "detectIntent", nodeLabel: "意图识别" },
        { nodeName: "webSearch", nodeLabel: "联网搜索", toolName: "webSearch" },
        { nodeName: "generateResponse", nodeLabel: "生成回答" },
      ];
    case "chat":
      return [
        { nodeName: "detectIntent", nodeLabel: "意图识别" },
        { nodeName: "generateResponse", nodeLabel: "生成回答" },
      ];
    case "auto":
    default:
      return [
        { nodeName: "detectIntent", nodeLabel: "意图识别" },
        { nodeName: "searchKnowledge", nodeLabel: "知识检索", toolName: "searchKnowledge" },
        { nodeName: "searchStructured", nodeLabel: "数据库查询", toolName: "searchStructured" },
        { nodeName: "generateResponse", nodeLabel: "生成回答" },
      ];
  }
}
