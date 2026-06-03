"use client";

import { createContext, useContext } from "react";

export const AdminRoleContext = createContext<string | null>(null);

export function useAdminRole() {
  return useContext(AdminRoleContext);
}
