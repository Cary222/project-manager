"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { IconProject } from "@/components/common/icons";
import { SimplePageHeader } from "@/components/ui/headers";
import { fetchJson } from "@/lib/fetch-json";
import { STALE_SWR_OPTIONS } from "@/lib/swr-config";

type Project = {
  id: string;
  name: string;
  description?: string;
};

function ProjectPickerSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse p-8">
      <div className="mb-6 h-8 w-32 rounded bg-ink-200" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl border border-ink-200 bg-white" />
        ))}
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  onSelect,
}: {
  projects: Project[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-4 text-lg font-semibold">选择项目</h2>
      <p className="mb-6 text-sm text-ink-500">
        请先选择一个项目，然后可以开始派单。
      </p>

      <div className="space-y-3">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            className="w-full rounded-xl border border-ink-200 bg-white p-4 text-left transition shadow-soft hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                <IconProject className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{project.name}</p>
                {project.description && (
                  <p className="mt-0.5 truncate text-sm text-ink-400">
                    {project.description}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DispatchTicketPage() {
  const router = useRouter();

  const { data, isLoading } = useSWR<{ projects: Project[] }>(
    "/api/projects",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const projects = useMemo(() => data?.projects ?? [], [data]);

  function handleSelectProject(projectId: string) {
    router.push(`/dispatchTicket/${projectId}`);
  }

  const header = <SimplePageHeader title="派单" subtitle="选择项目以开始派单" />;

  if (isLoading) {
    return (
      <AppShell header={header}>
        <ProjectPickerSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell header={header}>
      <ProjectPicker projects={projects} onSelect={handleSelectProject} />
    </AppShell>
  );
}
