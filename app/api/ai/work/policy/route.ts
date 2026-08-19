/**
 * Policy Rule 管理 API
 * 
 * GET  /api/ai/work/policy         - 查询所有规则
 * POST /api/ai/work/policy         - 创建新规则
 * PUT  /api/ai/work/policy/[id]    - 更新规则
 * DELETE /api/ai/work/policy/[id]  - 删除规则
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { clearPolicyCache } from "@/features/ai/agents/work/policy/tool-policy";

// ─── GET: 查询所有规则────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 只有 ROOT 用户可以管理 Policy
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ROOT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 查询参数
    const { searchParams } = new URL(request.url);
    const ruleType = searchParams.get("ruleType");
    const enabled = searchParams.get("enabled");

    const rules = await prisma.policyRule.findMany({
      where: {
        ...(ruleType && { ruleType: ruleType as any }),
        ...(enabled !== null && { enabled: enabled === "true" }),
      },
      orderBy: [
        { ruleType: "asc" },
        { targetName: "asc" },
      ],
    });

    return NextResponse.json({ rules });
  } catch (error) {
    console.error("[policy/GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch policy rules" },
      { status: 500 }
    );
  }
}

// ─── POST: 创建新规则─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ROOT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { ruleType, pattern, targetName, riskLevel, decision, requiresApproval, description, enabled, reason, priority } = body;

    // 参数校验
    if (!ruleType || !pattern || !decision) {
      return NextResponse.json(
        { error: "Missing required fields: ruleType, pattern, decision" },
        { status: 400 }
      );
    }

    const rule = await prisma.policyRule.create({
      data: {
        ruleType,
        pattern,
        targetName,
        riskLevel,
        decision,
        requiresApproval: requiresApproval ?? false,
        description,
        reason,
        priority: priority ?? 0,
        enabled: enabled ?? true,
      },
    });

    // 清除缓存，强制重新加载
    clearPolicyCache();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("[policy/POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to create policy rule" },
      { status: 500 }
    );
  }
}

// ─── PUT: 更新规则────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ROOT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { id, riskLevel, requiresApproval, description, enabled } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 }
      );
    }

    const rule = await prisma.policyRule.update({
      where: { id },
      data: {
        ...(riskLevel && { riskLevel }),
        ...(requiresApproval !== undefined && { requiresApproval }),
        ...(description !== undefined && { description }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    // 清除缓存
    clearPolicyCache();

    return NextResponse.json({ rule });
  } catch (error) {
    console.error("[policy/PUT] Error:", error);
    return NextResponse.json(
      { error: "Failed to update policy rule" },
      { status: 500 }
    );
  }
}

// ─── DELETE: 删除规则─────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ROOT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing required parameter: id" },
        { status: 400 }
      );
    }

    await prisma.policyRule.delete({
      where: { id },
    });

    // 清除缓存
    clearPolicyCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[policy/DELETE] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete policy rule" },
      { status: 500 }
    );
  }
}
