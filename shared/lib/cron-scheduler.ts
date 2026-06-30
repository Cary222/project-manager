/**
 * Cron scheduler for background jobs.
 * Currently runs the overdue ticket scanner every 5 minutes.
 *
 * Auto-starts when first imported. For Next.js App Router, this works because
 * the server module is loaded once per process lifetime.
 *
 * ⚠️ Known: Multi-instance deployment (e.g. multiple Next.js processes) will each
 * run the scanner independently. Use a DB/Redis lock (e.g. advisory lock, SELECT FOR
 * UPDATE SKIP LOCKED) if strict single-instance scan is required. Current
 * implementation is idempotent per-ticket via findMany + update; duplicate history
 * writes are possible under concurrent multi-instance scan but unlikely at low scale.
 */

import { TicketStatus } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { createModerationLog } from "@/features/admin/moderation";

let __started = false;
let __intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Scan for overdue tickets and mark them as OVERDUE.
 * A ticket is overdue when:
 * - deadline is set and in the past
 * - status is not in terminal states (DELIVERED, DONE, CLOSED, OVERDUE)
 */
export async function runOverdueScan(): Promise<number> {
  const now = new Date();

  const terminalStatuses: TicketStatus[] = [
    TicketStatus.DELIVERED,
    TicketStatus.DONE,
    TicketStatus.CLOSED,
    TicketStatus.OVERDUE,
  ];

  const overdueTickets = await prisma.ticket.findMany({
    where: {
      deadline: { not: null, lt: now },
      status: { notIn: terminalStatuses },
    },
    select: {
      id: true,
      ticketNo: true,
      title: true,
    },
  });

  if (overdueTickets.length === 0) {
    return 0;
  }

  const rootUser = await prisma.user.findFirst({
    where: { role: "ROOT" },
    select: { id: true },
  });

  if (!rootUser) {
    console.warn("[overdue-scan] No ROOT user found, skipping status history writes");
  }

  for (const ticket of overdueTickets) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: TicketStatus.OVERDUE },
        });

        await tx.ticketStatusHistory.create({
          data: {
            ticketId: ticket.id,
            status: TicketStatus.OVERDUE,
            changedById: rootUser?.id ?? "system",
          },
        });
      });

      console.log(`[overdue-scan] Marked ticket #${ticket.ticketNo} as OVERDUE`);
    } catch (error) {
      console.error(`[overdue-scan] Failed to mark ticket #${ticket.ticketNo} as OVERDUE:`, error);
    }
  }

  return overdueTickets.length;
}

/**
 * Start the overdue scanner (singleton).
 * Runs every 5 minutes.
 */
export function startOverdueScanner(): void {
  if (__started) {
    return;
  }

  __started = true;

  // Run immediately on start
  runOverdueScan().catch((error) => {
    console.error("[overdue-scan] Initial scan failed:", error);
  });

  // Then run every 5 minutes
  __intervalId = setInterval(() => {
    runOverdueScan().catch((error) => {
      console.error("[overdue-scan] Scheduled scan failed:", error);
    });
  }, 5 * 60 * 1000);

  console.log("[cron-scheduler] Overdue scanner started (5 min interval)");
}

/**
 * Stop the overdue scanner (for testing).
 */
export function stopOverdueScanner(): void {
  if (__intervalId) {
    clearInterval(__intervalId);
    __intervalId = null;
  }
  __started = false;
  console.log("[cron-scheduler] Overdue scanner stopped");
}

// Auto-start: the scanner begins as soon as this module is imported by the server.
// In Next.js App Router, the server module is loaded once per process lifetime.
if (process.env.NODE_ENV !== "test") {
  startOverdueScanner();
}
