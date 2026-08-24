import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = await getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  const trustOpts = await projectTrustReloadOptions(cwd, agentDir);
  if (trustOpts) {
    await loader.reload(trustOpts);
  }
  const { skills, diagnostics } = loader.getSkills();
  return {
    skills: annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: (await getProjectTrustStatus(cwd, agentDir)).trusted,
  };
}
