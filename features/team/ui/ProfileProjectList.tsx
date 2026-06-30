import Link from "next/link";
import type { UserProjectSummary } from "@/features/profile/lib/profile-actions";
import { IconProject } from "@/shared/ui/icons";

type Props = {
  projects: UserProjectSummary[];
  showMembers?: boolean;
};

const BADGE = {
  info: "bg-brand-100 text-brand-800",
  neutral: "bg-ink-100 text-ink-700",
} as const;

function MemberAvatar({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
      {name?.charAt(0) ?? "?"}
    </div>
  );
}

function ProjectWithMembers({ project }: { project: UserProjectSummary }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center gap-2 text-sm font-medium text-ink-900 transition hover:text-brand-600"
        >
          {project.name}
        </Link>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${BADGE.info}`}>
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
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
                  m.role === "OWNER"
                    ? "bg-brand-100 text-brand-800"
                    : "bg-ink-100 text-ink-700"
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
      className="group rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{project.name}</p>
          <p className="mt-1 text-xs text-ink-400">{project.role}</p>
        </div>
        <div className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${BADGE.info}`}>
          {project.role}
        </div>
      </div>
    </Link>
  );
}

export function ProfileProjectList({ projects, showMembers = false }: Props) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
        <div className="rounded-full bg-ink-100 p-3 text-ink-400">
          <IconProject className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有参与项目</h3>
        <p className="mt-1 text-sm text-ink-500">加入或创建一个项目开始协作</p>
        <Link
          href="/projects"
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          浏览项目
        </Link>
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
