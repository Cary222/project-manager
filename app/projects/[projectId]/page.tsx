import dynamic from "next/dynamic";
import { ProjectDetailLoading } from "@/components/ProjectDetail";

const ProjectDetail = dynamic(
  () => import("@/components/ProjectDetail").then((mod) => mod.ProjectDetail),
  {
    loading: () => <ProjectDetailLoading />,
  }
);

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} />;
}
