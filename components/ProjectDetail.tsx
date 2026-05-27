"use client";

import Link from "next/link";
import { AssigneePicker, formatAssigneeNames } from "@/components/AssigneePicker";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  assignees: User[];
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DONE";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

type Module = {
  id: string;
  name: string;
  description: string | null;
  tickets: Ticket[];
};

type Responsibility = {
  id: string;
  kind: "PROGRAM" | "DESIGN";
  modules: Module[];
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  responsibilities: Responsibility[];
};

const KIND_LABEL: Record<Responsibility["kind"], string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DONE: "已完成",
};

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResponsibilityId, setSelectedResponsibilityId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [newModuleName, setNewModuleName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) {
      setProject(null);
      return;
    }
    const data = (await res.json()) as { project: Project };
    setProject(data.project);
  }, [projectId]);

  useEffect(() => {
    loadProject().finally(() => setLoading(false));
  }, [loadProject]);

  useEffect(() => {
    if (!isRoot) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data: { users: User[] }) => setUsers(data.users));
  }, [isRoot]);

  const selectedResponsibility = useMemo(() => {
    return (
      project?.responsibilities.find((item) => item.id === selectedResponsibilityId) ??
      null
    );
  }, [project, selectedResponsibilityId]);

  const tickets = useMemo(() => {
    if (!selectedResponsibility) return [];
    return selectedResponsibility.modules.flatMap((module) => module.tickets);
  }, [selectedResponsibility]);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResponsibility || !title.trim()) return;

    setSubmitting(true);
    setMessage("");

    let targetModuleId = moduleId;
    if (!targetModuleId && newModuleName.trim()) {
      const moduleRes = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsibilityId: selectedResponsibility.id,
          name: newModuleName.trim(),
        }),
      });
      if (!moduleRes.ok) {
        setSubmitting(false);
        setMessage("创建模块失败");
        return;
      }
      const data = (await moduleRes.json()) as { module: Module };
      targetModuleId = data.module.id;
    }

    if (!targetModuleId) {
      setSubmitting(false);
      setMessage("请选择模块或填写新模块名称");
      return;
    }

    const ticketRes = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        moduleId: targetModuleId,
        assigneeIds,
        title: title.trim(),
        description: description.trim(),
      }),
    });

    setSubmitting(false);
    if (!ticketRes.ok) {
      setMessage("创建单子失败");
      return;
    }

    setTitle("");
    setDescription("");
    setNewModuleName("");
    setModuleId("");
    setAssigneeIds([]);
    setMessage("单子已创建");
    await loadProject();
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`确定删除单子 #${ticket.ticketNo} 吗？`)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除单子失败");
      return;
    }
    setMessage("单子已删除");
    await loadProject();
  }

  function insertImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (!src) return;
      setDescription((current) => {
        const prefix = current.trimEnd();
        const imageMarkdown = `![${file.name}](${src})`;
        return prefix ? `${prefix}\n\n${imageMarkdown}` : imageMarkdown;
      });
    };
    reader.readAsDataURL(file);
  }

  if (loading) {
    return <main className="p-6 text-sm text-zinc-500">加载中...</main>;
  }

  if (!project) {
    return (
      <main className="p-6">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
          返回项目
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          项目不存在
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
            返回项目
          </Link>
          <h1 className="mt-1 text-lg font-semibold">{project.name}</h1>
          {project.description ? (
            <p className="text-sm text-zinc-500">{project.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          退出
        </button>
      </header>

      <main className="grid grid-cols-12 gap-4 p-6">
        <section className="col-span-3 space-y-3">
          <h2 className="text-sm font-medium text-zinc-500">职能</h2>
          {project.responsibilities.map((responsibility) => (
            <button
              key={responsibility.id}
              type="button"
              onClick={() => {
                setSelectedResponsibilityId(responsibility.id);
                setModuleId("");
                setMessage("");
              }}
              className={`w-full rounded-xl border bg-white p-4 text-left transition ${
                selectedResponsibilityId === responsibility.id
                  ? "border-zinc-900"
                  : "border-zinc-200 hover:border-zinc-300"
              }`}
            >
              <p className="font-medium">{KIND_LABEL[responsibility.kind]}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {responsibility.modules.reduce(
                  (sum, module) => sum + module.tickets.length,
                  0
                )}{" "}
                个单子
              </p>
            </button>
          ))}
        </section>

        <section className="col-span-9 rounded-xl border border-zinc-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-medium">单子</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedResponsibility
                  ? `${KIND_LABEL[selectedResponsibility.kind]}职能`
                  : "请选择职能"}
              </p>
            </div>
          </div>

          {message ? (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}

          {isRoot && selectedResponsibility ? (
            <form
              onSubmit={createTicket}
              className="mb-5 grid gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-4"
            >
              <p className="text-sm font-medium">新建单子</p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>选择模块</span>
                  <select
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
                  >
                    <option value="">不选择，使用新模块</option>
                    {selectedResponsibility.modules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>新模块名称</span>
                  <input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="没有合适模块时填写"
                    className="w-full rounded-md border border-zinc-300 px-3 py-2"
                  />
                </label>
              </div>
              <div className="space-y-2 text-sm">
                <span>指派给</span>
                <AssigneePicker
                  users={users}
                  value={assigneeIds}
                  onChange={setAssigneeIds}
                />
              </div>
              <label className="space-y-1 text-sm">
                <span>标题</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2"
                  required
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>描述（Markdown）</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={"支持 Markdown，例如：\n## 标题\n- 列表\n![图片](图片地址)"}
                  className="min-h-32 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="w-fit cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100">
                插入图片
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) insertImage(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {submitting ? "创建中..." : "创建单子"}
              </button>
            </form>
          ) : null}

          {!selectedResponsibility ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
              请选择职能
            </p>
          ) : tickets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
              暂无
            </p>
          ) : (
            <div className="space-y-5">
              {selectedResponsibility.modules.map((module) => (
                <div key={module.id}>
                  <p className="mb-2 text-xs font-medium text-zinc-500">
                    {module.name}
                  </p>
                  {module.tickets.length === 0 ? (
                    <p className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-400">
                      暂无
                    </p>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {module.tickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="rounded-lg border border-zinc-200 px-3 py-2 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          <Link href={`/${ticket.ticketNo}`} className="block">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">#{ticket.ticketNo}</span>
                              <span className="text-sm text-zinc-500">
                                {STATUS_LABEL[ticket.status]}
                              </span>
                            </div>
                            <p className="mt-1 text-sm">{ticket.title}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              指派：{formatAssigneeNames(ticket.assignees)}
                            </p>
                          </Link>
                          {isRoot ? (
                            <button
                              type="button"
                              onClick={() => deleteTicket(ticket)}
                              className="mt-2 text-xs text-red-600 hover:text-red-700"
                            >
                              删除单子
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
