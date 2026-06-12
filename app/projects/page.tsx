import dynamic from "next/dynamic";
import { ProjectsListLoading } from "@/components/project/ProjectsList";

const ProjectsList = dynamic(
  () => import("@/components/project/ProjectsList").then((mod) => mod.ProjectsList),
  {
    loading: () => <ProjectsListLoading />,
  }
);

export default function ProjectsPage() {
  return <ProjectsList />;
}
