"use client";

import { useEffect, useRef, useState } from "react";

type UserOption = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

function userLabel(user: UserOption) {
  return `${user.name || user.email}（${user.role}）`;
}

export function AssigneePicker({
  users,
  value,
  onChange,
}: {
  users: UserOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle(userId: string) {
    onChange(
      value.includes(userId)
        ? value.filter((id) => id !== userId)
        : [...value, userId]
    );
  }

  if (users.length === 0) {
    return <p className="text-sm text-zinc-500">暂无可指派用户</p>;
  }

  const selectedUsers = users.filter((user) => value.includes(user.id));
  const summary =
    selectedUsers.length === 0
      ? "选择指派人"
      : selectedUsers.map((user) => user.name || user.email).join("、");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm"
      >
        <span className={selectedUsers.length === 0 ? "text-zinc-400" : "text-zinc-900"}>
          {summary}
        </span>
        <span className="text-zinc-400">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
          {users.map((user) => {
            const selected = value.includes(user.id);
            return (
              <label
                key={user.id}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 ${
                  selected ? "bg-zinc-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggle(user.id)}
                  className="rounded border-zinc-300"
                />
                <span>{userLabel(user)}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function formatAssigneeNames(
  assignees: { name: string | null; email: string; role?: string }[]
) {
  if (assignees.length === 0) return "未指派";
  return assignees.map((user) => user.name || user.email).join("、");
}
