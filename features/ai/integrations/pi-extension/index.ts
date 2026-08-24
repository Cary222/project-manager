/**
 * Pi Extension - ProjectHub 业务工具注册
 *
 * Phase 4: 将 ProjectHub 业务工具注册到 Pi Runtime
 *
 * 架构：
 * - tools/: 各个业务工具实现
 * - index.ts: Extension 入口，注册所有工具
 */

export { queryProjectTool } from "./tools/query-project";
export { queryTicketTool } from "./tools/query-ticket";
export { queryCommitsTool } from "./tools/query-commits";
export { submitReportTool } from "./tools/submit-report";

// Re-export searchStructured tool from existing implementation
export { searchStructured } from "@/features/ai/tools/search-structured";
