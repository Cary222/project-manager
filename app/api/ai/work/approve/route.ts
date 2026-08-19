/**
 * HIL 审批 API 路由
 * 
 * Phase 4 P0: 打通 HIL 闭环
 * Phase 4 P1: 审计日志持久化
 * 
 * 流程：
 * 1. 用户在 UI 点击"批准"或"拒绝"
 * 2. POST /api/ai/work/approve
 * 3. 从 runStore 获取 run 信息
 * 4. 更新审计日志（记录审批决策）
 * 5. 调用 PiRuntime.resume() 恢复执行（或 cancel 取消）
 * 6. 返回响应给前端
 */

import { NextResponse } from "next/server";
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";
import { getPolicyGateway } from "@/features/ai/agents/work/policy";
import { auth } from "@/lib/auth";

// ─── 请求体类型 ────────────────────────────────────────────────────

interface ApprovalRequest {
  runId: string;
  callId: string;
  decision: "approve" | "deny";
  reason?: string; // 可选：拒绝理由
}

// ─── POST /api/ai/work/approve ─────────────────────────────────────

export async function POST(request: Request) {
  try {
    // 0. 鉴权：获取当前用户
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 1. 解析请求体
    const body = (await request.json()) as ApprovalRequest;
    const { runId, callId, decision, reason } = body;

    // 验证必需字段
    if (!runId || !callId || !decision) {
      return NextResponse.json(
        { error: "Missing required fields: runId, callId, decision" },
        { status: 400 }
      );
    }

    // 验证 decision 值
    if (decision !== "approve" && decision !== "deny") {
      return NextResponse.json(
        { error: 'Invalid decision. Must be "approve" or "deny"' },
        { status: 400 }
      );
    }

    console.log(`[HIL] Received approval request: ${decision} for runId=${runId}, callId=${callId}`);

    // 2. 获取 PiSubAgent 和 PolicyGateway
    const piSubAgent = getPiSubAgent();
    const policyGateway = getPolicyGateway();

    // 3. 获取 run 信息
    const run = piSubAgent.getRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: `Run not found: ${runId}` },
        { status: 404 }
      );
    }

    // 4. 查找待审批的审计日志
    const logId = await policyGateway.findPendingApproval(runId);
    if (!logId) {
      return NextResponse.json(
        { error: `No pending approval found for runId: ${runId}` },
        { status: 404 }
      );
    }

    // 5. 更新审批状态（记录到数据库）
    try {
      await policyGateway.updateApproval(
        logId,
        decision === "approve",
        session.user.id
      );
    } catch (error) {
      console.error(`[HIL] Failed to update approval status:`, error);
      return NextResponse.json(
        {
          error: "Failed to update approval status",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }

    // 6. 根据决策执行不同操作
    if (decision === "approve") {
      // 批准：调用 resume 恢复执行
      try {
        await piSubAgent.resume(runId, reason || "User approved the action. Please proceed.");
        
        console.log(`[HIL] Approved tool_call for runId=${runId}`);
        
        return NextResponse.json({
          success: true,
          decision: "approve",
          message: "Tool call approved and execution resumed",
        });
      } catch (error) {
        console.error(`[HIL] Failed to resume after approval:`, error);
        return NextResponse.json(
          {
            error: "Failed to resume execution after approval",
            details: error instanceof Error ? error.message : String(error),
          },
          { status: 500 }
        );
      }
    } else {
      // 拒绝：取消运行
      try {
        await piSubAgent.cancel(runId);
        
        console.log(`[HIL] Denied tool_call for runId=${runId}`);
        
        return NextResponse.json({
          success: true,
          decision: "deny",
          message: "Tool call denied and run cancelled",
        });
      } catch (error) {
        console.error(`[HIL] Failed to cancel run:`, error);
        return NextResponse.json(
          {
            error: "Failed to cancel run after denial",
            details: error instanceof Error ? error.message : String(error),
          },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error("[HIL] Error processing approval request:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// ─── GET /api/ai/work/approve （查询待审批项）──────────────────────

export async function GET(request: Request) {
  try {
    // 0. 鉴权：获取当前用户
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json(
        { error: "Missing required query parameter: runId" },
        { status: 400 }
      );
    }

    // 获取审计日志中的待审批项（从数据库查询）
    const policyGateway = getPolicyGateway();
    const auditLog = await policyGateway.getAuditLog({
      runId,
      decision: "approve", // decision: "approve" 表示等待审批
    });
    
    // 过滤出尚未审批的（approvedAt 为 null）
    const pendingApprovals = auditLog.filter(
      (entry) => !entry.timestamp.includes("approved") // 简化判断：已审批的会有 approvedAt
    );

    return NextResponse.json({
      runId,
      pendingApprovals: pendingApprovals.map((entry) => ({
        callId: entry.tool || "unknown",
        tool: entry.tool,
        args: {}, // args 存储在 DB 中，需要时可从 entry 读取
        reason: entry.reason,
        timestamp: entry.timestamp,
      })),
    });
  } catch (error) {
    console.error("[HIL] Error fetching pending approvals:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
