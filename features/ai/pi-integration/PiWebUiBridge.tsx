"use client";

import { AppShell } from "@/features/ai/ui/ai-workspace/AppShell";
import "@/features/ai/ui/ai-workspace/styles/pi-web.css";
import "@/features/ai/ui/ai-workspace/styles/settings.css";

/** The only React-level Pi Web dependency exposed to ProjectHub Work. */
export function PiWebUiBridge() {
  return <AppShell />;
}
