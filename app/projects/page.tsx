import dynamic from "next/dynamic";
import { ProjectsListLoading } from "@/components/ProjectsList";

const ProjectsList = dynamic(
  () => import("@/components/ProjectsList").then((mod) => mod.ProjectsList),
  {
    loading: () => <ProjectsListLoading />,
  }
);

export default function ProjectsPage() {
  return <ProjectsList />;
}
