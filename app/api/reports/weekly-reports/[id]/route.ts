import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getWeeklyReport, updateWeeklyReport, deleteWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";

const updateSchema = z.object({
  weekStart: z.string().datetime().optional(),
  weekEnd: z.string().datetime().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  attachments: z.array(z.object({
    fileId: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })).optional(),
  projectIds: z.array(z.string()).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const report = await getWeeklyReport(id, session.user.id);
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ report });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    const input: Parameters<typeof updateWeeklyReport>[2] = {};
    if (data.title !== undefined) input.title = data.title;
    if (data.content !== undefined) input.content = data.content;
    if (data.attachments !== undefined) input.attachments = data.attachments;
    if (data.projectIds !== undefined) input.projectIds = data.projectIds;

    const report = await updateWeeklyReport(id, session.user.id, input);

    // fire-and-forget: 内容变更后触发画像刷新（依赖 enqueueUpdateProfile 去重）
    void enqueueSummarizeWeeklyReport(id);

    return NextResponse.json({ report }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await deleteWeeklyReport(id, session.user.id);
  return new NextResponse(null, { status: 204 });
}
