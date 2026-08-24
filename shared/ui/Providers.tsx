"use client";

import { SessionProvider } from "next-auth/react";
import { VisitsProvider } from "@/shared/lib/visits-context";
import { SidebarCollapsedContext } from "@/shared/ui/SidebarStateContext";

export function Providers({
  children,
  initialSidebarCollapsed,
}: {
  children: React.ReactNode;
  initialSidebarCollapsed: boolean;
}) {
  return (
    <SessionProvider>
      <VisitsProvider>
        <SidebarCollapsedContext.Provider value={initialSidebarCollapsed}>
          {children}
        </SidebarCollapsedContext.Provider>
      </VisitsProvider>
    </SessionProvider>
  );
}
