import dynamic from "next/dynamic";
import { AppShell } from "@/shared/ui/AppShell";
import { SimplePageHeader } from "@/shared/ui/headers";
import { TasksBoardLoading, TasksBoardHeaderSkeleton } from "@/features/task/TasksBoard";

const TasksBoard = dynamic(
  () => import("@/features/task/TasksBoard").then((mod) => mod.TasksBoard),
  {
    loading: () => <TasksBoardLoading />,
  }
);

export default function TasksPage() {
  return (
    <AppShell header={<SimplePageHeader title="任务看板" subtitle="Task Board · 指派给我的任务" />}>
      <TasksBoard />
    </AppShell>
  );
}
