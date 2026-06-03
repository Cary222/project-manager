"use client";

import { AdminRoleContext } from "./context";
import { ReactNode } from "react";

export function AdminRoleProvider({
  role,
  children,
}: {
  role: string;
  children: ReactNode;
}) {
  return (
    <AdminRoleContext.Provider value={role}>
      {children}
    </AdminRoleContext.Provider>
  );
}
