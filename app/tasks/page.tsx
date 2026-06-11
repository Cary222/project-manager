import dynamic from "next/dynamic";
import { AppShell } from "@/components/AppShell";
import { TasksBoardLoading, TasksBoardHeaderSkeleton } from "@/components/TasksBoard";

const TasksBoard = dynamic(
  () => import("@/components/TasksBoard").then((mod) => mod.TasksBoard),
  {
    loading: () => <TasksBoardLoading />,
  }
);

function TasksBoardHeader() {
  return (
    <div>
      <h1 className="text-lg font-semibold leading-tight">任务看板</h1>
      <p className="text-xs text-ink-400">Task Board · 指派给我的任务</p>
    </div>
  );
}

export default function TasksPage() {
  return (
    <AppShell header={<TasksBoardHeader />}>
      <TasksBoard />
    </AppShell>
  );
}
