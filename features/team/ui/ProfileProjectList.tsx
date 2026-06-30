import Link from "next/link";
import type { UserProjectSummary } from "@/features/profile/lib/profile-actions";

type Props = {
  projects: UserProjectSummary[];
  showMembers?: boolean;
};

function MemberAvatar({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-xs font-medium">
      {name?.charAt(0) ?? "?"}
    </div>
  );
}

function ProjectWithMembers({ project }: { project: UserProjectSummary }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center gap-2 text-sm font-medium text-ink-900 transition hover:text-brand-600"
        >
          {project.name}
        </Link>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
          {project.role}
        </span>
      </div>
      {project.members.length === 0 ? (
        <p className="text-xs text-ink-400">暂无成员</p>
      ) : (
        <ul className="space-y-2">
          {project.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <MemberAvatar name={m.name} email={m.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink-700">{m.name || "—"}</p>
                <p className="truncate text-[10px] text-ink-400">{m.email}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  m.role === "OWNER"
                    ? "bg-brand-50 text-brand-700"
                    : "bg-ink-100 text-ink-500"
                }`}
              >
                {m.role === "OWNER" ? "负责人" : "成员"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: UserProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="rounded-xl border border-ink-100 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/20 hover:shadow-soft"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{project.name}</p>
          <p className="mt-1 text-xs text-ink-400">{project.role}</p>
        </div>
        <div className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
          {project.role}
        </div>
      </div>
    </Link>
  );
}

export function ProfileProjectList({ projects, showMembers = false }: Props) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/30 p-6 text-center text-sm text-ink-400">
        暂无参与项目
      </div>
    );
  }

  if (showMembers) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((p) => (
          <ProjectWithMembers key={p.id} project={p} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}
