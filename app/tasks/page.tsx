import dynamic from "next/dynamic";
import { TasksBoardLoading } from "@/components/TasksBoard";

const TasksBoard = dynamic(
  () => import("@/components/TasksBoard").then((mod) => mod.TasksBoard),
  {
    loading: () => <TasksBoardLoading />,
  }
);

export default function TasksPage() {
  return <TasksBoard />;
}
