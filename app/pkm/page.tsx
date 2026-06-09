import { AppShell } from "@/components/AppShell";
import { PkmBoard } from "@/components/pkm/PkmBoard";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

function serializeNote(note: {
  id: string;
  title: string;
  content: string;
  tags: string[];
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export default async function PkmPage({
  searchParams,
}: {
  searchParams?: Promise<{ noteId?: string }>;
}) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : undefined;
  const noteId = params?.noteId ?? "";

  const [notes, projects] = await Promise.all([
    prisma.pkmNote.findMany({
      where: { userId: session.user.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);
  const serializedNotes = notes.map(serializeNote);

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">PKM · 个人知识库</h1>
          <p className="text-xs text-ink-400">Personal Knowledge Management · 沉淀经验，驱动团队知识检索</p>
        </div>
      }
    >
      <PkmBoard initialNotes={serializedNotes} projects={projects} initialNoteId={noteId} />
    </AppShell>
  );
}
