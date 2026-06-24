"use client";

import { SessionProvider } from "next-auth/react";
import { VisitsProvider } from "@/shared/lib/visits-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <VisitsProvider>{children}</VisitsProvider>
    </SessionProvider>
  );
}
