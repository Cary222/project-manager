/**
 * Weekly Report Workflow — Template
 *
 * 通用工作流节点顺序（参考）。
 * 新增 Workflow 时复制此模板。
 */

export const WORKFLOW_TEMPLATE_NODES = [
  "collectData",
  "draft",
  "waitReview",
  "revise",
  "output",
] as const;

export type WorkflowTemplateNode = (typeof WORKFLOW_TEMPLATE_NODES)[number];
