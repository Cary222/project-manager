import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listMyWeeklyReports, createWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";

const createSchema = z.object({
  weekStart: z.string().datetime(),
  weekEnd: z.string().datetime(),
  title: z.string().min(1).max(200),
  content: z.string(),
  attachments: z.array(z.object({
    fileId: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })).optional(),
  projectIds: z.array(z.string()).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const cursor = searchParams.get("cursor") ?? undefined;

  const reports = await listMyWeeklyReports(session.user.id, { limit, cursor });
  return NextResponse.json({
    reports,
    nextCursor: reports.length === limit ? reports[reports.length - 1].id : null,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    const report = await createWeeklyReport(session.user.id, {
      weekStart: new Date(data.weekStart),
      weekEnd: new Date(data.weekEnd),
      title: data.title,
      content: data.content,
      attachments: data.attachments,
      projectIds: data.projectIds,
    });

    // fire-and-forget: HTTP 响应不能等 LLM 完成，要立即返回 201
    void enqueueSummarizeWeeklyReport(report.id);

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.includes("Unique")) {
      return NextResponse.json(
        { error: "本周已存在周报，请用 PATCH 更新" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
