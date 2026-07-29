/**
 * overdue-scan-test.ts
 *
 * Integration tests for runOverdueScan using the real database.
 * 
 * Tests:
 * 1. Ticket with deadline in the past + DEVELOPING → becomes OVERDUE
 * 2. Ticket with deadline in the past + DONE → stays DONE
 * 3. Ticket with deadline in the future + DEVELOPING → stays DEVELOPING
 * 4. Ticket with deadline in the past + OVERDUE → stays OVERDUE (no double-processing)
 *
 * Prerequisite: DATABASE_URL env var must be set.
 * Run: DATABASE_URL="postgresql://..." npx tsx scripts/overdue-scan-test.ts
 */

import { prisma } from "@/shared/db/client";
import { runOverdueScan, stopOverdueScanner } from "@/worker/lib/cron-scheduler";
import { TicketStatus } from "@prisma/client";

function pass(name: string) { console.log(`  ✓ ${name}`); }
function fail(name: string, reason: string) {
  console.error(`  ✗ ${name}: ${reason}`);
}

async function cleanupTestData(prefix = "TEST_OVERDUE") {
  await prisma.ticket.deleteMany({
    where: {
      title: { startsWith: prefix },
    },
  });
}

async function createTestTicket(title: string, deadline: Date | null, status: TicketStatus) {
  // Find or create a test project
  let project = await prisma.project.findFirst({ take: 1 });
  if (!project) {
    throw new Error("No project found in database. Please seed the database first.");
  }

  // Find or create a test module
  let module = await prisma.module.findFirst({ take: 1 });
  if (!module) {
    throw new Error("No module found in database. Please seed the database first.");
  }

  // Find a test user
  const user = await prisma.user.findFirst({ where: { role: "ROOT" } });
  if (!user) {
    throw new Error("No ROOT user found in database. Please seed the database first.");
  }

  // Get next ticket number
  const counter = await prisma.counter.upsert({
    where: { key: "ticket_no" },
    update: { nextValue: { increment: 1 } },
    create: { key: "ticket_no", nextValue: 1 },
  });
  const ticketNo = counter.nextValue;

  const ticket = await prisma.ticket.create({
    data: {
      ticketNo,
      title,
      description: null,
      projectId: project.id,
      moduleId: module.id,
      creatorId: user.id,
      status,
      deadline,
    },
  });

  // Write initial status history
  await prisma.ticketStatusHistory.create({
    data: {
      ticketId: ticket.id,
      status,
      changedById: user.id,
    },
  });

  return ticket;
}

async function main() {
  console.log("[overdue-scan integration tests]");
  console.log("(requires DATABASE_URL env var)\n");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL env var is required");
    console.log("Usage: DATABASE_URL=\"postgresql://...\" npx tsx scripts/overdue-scan-test.ts");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  try {
    await cleanupTestData();

    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000); // 2 days ago
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000); // 2 days from now

    // Test 1: Ticket with deadline in the past + DEVELOPING → becomes OVERDUE
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 1: past deadline + DEVELOPING",
        past,
        TicketStatus.DEVELOPING
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "OVERDUE") {
        pass("runOverdueScan: past deadline + DEVELOPING → OVERDUE");
        passed++;
      } else {
        fail("runOverdueScan: past deadline + DEVELOPING", `expected OVERDUE, got ${updated?.status}`);
        failed++;
      }

      // Verify status history was written
      const history = await prisma.ticketStatusHistory.findMany({
        where: { ticketId: ticket.id, status: "OVERDUE" },
        orderBy: { createdAt: "desc" },
      });
      if (history.length > 0) {
        pass("runOverdueScan: writes OVERDUE to status history");
        passed++;
      } else {
        fail("runOverdueScan: writes OVERDUE to status history", "no OVERDUE history found");
        failed++;
      }
    }

    // Test 2: Ticket with deadline in the past + DONE → stays DONE
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 2: past deadline + DONE",
        past,
        TicketStatus.DONE
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "DONE") {
        pass("runOverdueScan: past deadline + DONE → stays DONE");
        passed++;
      } else {
        fail("runOverdueScan: past deadline + DONE", `expected DONE, got ${updated?.status}`);
        failed++;
      }
    }

    // Test 3: Ticket with deadline in the future + DEVELOPING → stays DEVELOPING
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 3: future deadline + DEVELOPING",
        future,
        TicketStatus.DEVELOPING
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "DEVELOPING") {
        pass("runOverdueScan: future deadline + DEVELOPING → stays DEVELOPING");
        passed++;
      } else {
        fail("runOverdueScan: future deadline + DEVELOPING", `expected DEVELOPING, got ${updated?.status}`);
        failed++;
      }
    }

    // Test 4: Ticket with deadline in the past + OVERDUE → stays OVERDUE (no double-processing)
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 4: past deadline + OVERDUE",
        past,
        TicketStatus.OVERDUE
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "OVERDUE") {
        pass("runOverdueScan: past deadline + OVERDUE → stays OVERDUE");
        passed++;
      } else {
        fail("runOverdueScan: past deadline + OVERDUE", `expected OVERDUE, got ${updated?.status}`);
        failed++;
      }
    }

    // Test 5: Ticket with deadline in the past + CLOSED → stays CLOSED
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 5: past deadline + CLOSED",
        past,
        TicketStatus.CLOSED
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "CLOSED") {
        pass("runOverdueScan: past deadline + CLOSED → stays CLOSED");
        passed++;
      } else {
        fail("runOverdueScan: past deadline + CLOSED", `expected CLOSED, got ${updated?.status}`);
        failed++;
      }
    }

    // Test 6: Ticket with no deadline → stays DEVELOPING
    {
      const ticket = await createTestTicket(
        "TEST_OVERDUE 6: no deadline",
        null,
        TicketStatus.DEVELOPING
      );
      const count = await runOverdueScan();
      const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      if (updated?.status === "DEVELOPING") {
        pass("runOverdueScan: no deadline → stays DEVELOPING");
        passed++;
      } else {
        fail("runOverdueScan: no deadline", `expected DEVELOPING, got ${updated?.status}`);
        failed++;
      }
    }

    // Cleanup
    await cleanupTestData();

  } catch (error) {
    console.error("Test error:", error);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("\n[OVERDUE SCAN TESTS OK]");
    process.exit(0);
  } else {
    console.log("\n[OVERDUE SCAN TESTS FAIL]");
    process.exit(1);
  }
}

// Make sure to stop the scheduler after tests
process.on("exit", () => {
  stopOverdueScanner();
});

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
