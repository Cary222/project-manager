import Link from "next/link";
import type { UserProjectSummary } from "@/features/profile/lib/profile-actions";

type Props = {
  projects: UserProjectSummary[];
};

export function ProfileProjectList({ projects }: Props) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/30 p-6 text-center text-sm text-ink-400">
        暂无参与项目
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          className="rounded-xl border border-ink-100 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/20 hover:shadow-soft"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{p.name}</p>
              <p className="mt-1 text-xs text-ink-400">{p.role}</p>
            </div>
            <div className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
              {p.role}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
