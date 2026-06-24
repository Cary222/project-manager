export type TaskStats = {
  total: number;
  dev: number;
  test: number;
  delivered: number;
  done: number;
  rate: number;
};

export function TaskStatsCards({ stats }: { stats: TaskStats }) {
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <p className="text-sm text-ink-500">任务完成率</p>
        <p className="mt-2 text-3xl font-semibold text-brand-600">{stats.rate}%</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${stats.rate}%` }}
          />
        </div>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <p className="text-sm text-ink-500">进行中任务</p>
        <p className="mt-2 text-3xl font-semibold">{stats.dev}</p>
        <p className="mt-1 text-xs text-ink-400">开发中</p>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <p className="text-sm text-ink-500">待测试任务</p>
        <p className="mt-2 text-3xl font-semibold text-warning">{stats.test}</p>
        <p className="mt-1 text-xs text-ink-400">等待验收</p>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <p className="text-sm text-ink-500">已交付任务</p>
        <p className="mt-2 text-3xl font-semibold text-violet-700">{stats.delivered}</p>
        <p className="mt-1 text-xs text-ink-400">等待确认完成</p>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <p className="text-sm text-ink-500">已完成任务</p>
        <p className="mt-2 text-3xl font-semibold text-emerald-600">{stats.done}</p>
        <p className="mt-1 text-xs text-ink-400">累计完成</p>
      </div>
    </section>
  );
}
