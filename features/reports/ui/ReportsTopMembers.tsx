"use client";

type TopMember = {
  userId: string;
  name: string | null;
  image: string | null;
  done: number;
  rate: number;
};

export function ReportsTopMembers({ members }: { members: TopMember[] }) {
  if (members.length === 0) {
    return (
      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <h2 className="mb-4 font-medium">成员贡献 TOP</h2>
        <p className="text-sm text-ink-400">暂无贡献数据</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-4 font-medium">成员贡献 TOP</h2>
      <ul className="space-y-3">
        {members.map((m, i) => (
          <li key={m.userId} className="flex items-center gap-3">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                i === 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-ink-100 text-ink-500"
              }`}
            >
              {i + 1}
            </span>
            <span className="flex-1 text-sm font-medium">{m.name ?? "未知成员"}</span>
            <span className="text-sm text-ink-500">完成 {m.done}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
              {m.rate}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
