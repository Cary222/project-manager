import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import { EVENT_VERSION } from "@/shared/lib/events/ACTION";
import { routeEvent, isRoutableAction } from "@/shared/lib/events/router";
import { computeDwellMetrics } from "@/shared/lib/events/compute";
import type { RawEvent } from "@/shared/lib/events/types";

/**
 * 事件网关（Event Gateway）
 *
 * 设计原则：
 * 1. 前端只负责记录发生，发送原始数据
 * 2. 后端计算 isValidView（防前端篡改阈值）
 * 3. 静默失败：事件统计不影响主业务
 * 4. Tier 3 事件（ticket.* / project.* / note.* / admin.*）由独立系统承担，
 *    Gateway 不接受，避免双写
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as RawEvent;

    if (!body.action?.trim()) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }

    // 拒绝非白名单事件（防误用 + 防被攻击者灌垃圾）
    if (!isRoutableAction(body.action)) {
      return NextResponse.json({ error: "action not routable" }, { status: 400 });
    }

    // 路由决策（骨架：当前只分类，后续按分类扩展 writer）
    routeEvent(body.action);

    // 后端计算 dwellMs / isValidView（可信数据，前端不可干预）
    const { dwellMs, isValidView } = computeDwellMetrics(body.action, body.context);

    await prisma.activityLog.create({
      data: {
        eventVersion: EVENT_VERSION,
        action: body.action.trim(),
        actorId: session.user.id,
        actorName: session.user.name ?? session.user.email ?? "未知",
        targetType: body.targetType ?? null,
        targetId: body.targetId ?? null,
        targetName: body.targetName ?? null,
        sessionId: body.sessionId ?? null,
        context: (body.context ?? {}) as object,
        dwellMs,
        isValidView,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    // 静默失败：事件统计不能影响主业务
    console.error("[events] POST error:", error);
    return NextResponse.json({ ok: true });
  }
}