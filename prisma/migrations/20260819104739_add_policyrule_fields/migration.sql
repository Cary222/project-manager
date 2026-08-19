-- AlterTable: 给 PolicyRule 添加新字段
ALTER TABLE "pm"."PolicyRule" ADD COLUMN "targetName" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN "description" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- 注释: 这些字段用于 tool-policy 动态加载
-- targetName: 工具名称 (如 "git_push", "file_write")
-- riskLevel: 风险等级 (SAFE/LOW/MEDIUM/HIGH/DANGEROUS)
-- description: 规则描述
-- requiresApproval: 是否需要 HIL 审批
