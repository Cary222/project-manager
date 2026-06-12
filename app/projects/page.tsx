import dynamic from "next/dynamic";
import { ProjectsListLoading } from "@/features/project/ui/ProjectsList";

const ProjectsList = dynamic(
  () => import("@/features/project/ui/ProjectsList").then((mod) => mod.ProjectsList),
  {
    loading: () => <ProjectsListLoading />,
  }
);

export default function ProjectsPage() {
  return <ProjectsList />;
}
