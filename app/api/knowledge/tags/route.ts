import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const notes = await prisma.pkmNote.findMany({
    where: { isPublic: true },
    select: { tags: true },
  });

  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const result = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);

  return NextResponse.json(result);
}
