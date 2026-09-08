import type { NextRequest } from "next/server";
import { handleGraphRequest } from "@/features/knowledge/lib/graph/view-handler";

export async function GET(req: NextRequest) {
  return handleGraphRequest(req, "subgraph");
}
