import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReportsStats } from "@/features/reports/lib/reports-store";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getReportsStats();

    // Fill teamHealth: ROOT only gets real value, others get 0
    if (session.user.role !== "ROOT") {
      stats.kpis.teamHealth = 0;
    } else {
      const { projectStatus } = stats;
      const { completionRate } = stats.kpis;
      const healthyProjects = projectStatus.good + projectStatus.normal;
      const totalProjects = healthyProjects + projectStatus.attention + projectStatus.risk;
      const healthScore = totalProjects > 0
        ? Math.round((healthyProjects / totalProjects) * 50 + completionRate * 0.5)
        : completionRate;
      stats.kpis.teamHealth = Math.min(100, healthScore);
    }

    return NextResponse.json(
      { data: stats, error: null },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      }
    );
  } catch (err) {
    console.error("[api/reports/stats] error:", err);
    return NextResponse.json(
      { data: null, error: "Internal server error" },
      { status: 500 }
    );
  }
}
