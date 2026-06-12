import dynamic from "next/dynamic";
import { AppShell } from "@/components/AppShell";
import { SimplePageHeader } from "@/components/ui/headers";
import { TasksBoardLoading, TasksBoardHeaderSkeleton } from "@/components/task/TasksBoard";

const TasksBoard = dynamic(
  () => import("@/components/task/TasksBoard").then((mod) => mod.TasksBoard),
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
