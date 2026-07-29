/**
 * ticket-deadline-unit-test.ts
 *
 * Pure function tests for ticket deadline utilities:
 * - computeDefaultDeadline behavior on Mon/Wed/Sat/Sun 23:00
 * - isOverdue scenarios
 * - isDeadlineApproaching scenarios
 *
 * Run: npx tsx scripts/ticket-deadline-unit-test.ts
 */

function pass(name: string) { console.log(`  ✓ ${name}`); }
function fail(name: string, reason: string) {
  console.error(`  ✗ ${name}: ${reason}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Pure helpers (copied from shared/lib/ticket-deadline for standalone testing)
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 3600 * 1000;
const ONE_DAY_MS = 24 * 3600 * 1000;

function toUtcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toUtcEndOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function getWeekRange(reference: Date): { weekStart: Date; weekEnd: Date } {
  const utc = toUtcStartOfDay(reference);
  const day = utc.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(utc.getTime() + offset * 24 * 60 * 60 * 1000);
  return {
    weekStart: toUtcStartOfDay(monday),
    weekEnd: toUtcEndOfDay(new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)),
  };
}

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE" | "OVERDUE" | "CLOSED";

function computeDefaultDeadline(now: Date): Date {
  const { weekEnd } = getWeekRange(now);
  const msUntilWeekEnd = weekEnd.getTime() - now.getTime();

  if (msUntilWeekEnd < ONE_DAY_MS) {
    return new Date(weekEnd.getTime() + 7 * 24 * 3600 * 1000);
  }

  return weekEnd;
}

function isOverdue(
  ticket: { deadline: Date | null; status: TicketStatus },
  now: Date = new Date()
): boolean {
  if (!ticket.deadline) return false;
  if (ticket.deadline >= now) return false;

  const terminalStatuses: TicketStatus[] = [
    "DELIVERED",
    "DONE",
    "CLOSED",
  ];
  return !terminalStatuses.includes(ticket.status);
}

function isDeadlineApproaching(
  ticket: { deadline: Date | null; status: TicketStatus },
  now: Date = new Date()
): boolean {
  if (!ticket.deadline) return false;

  const terminalStatuses: TicketStatus[] = [
    "DELIVERED",
    "DONE",
    "CLOSED",
    "OVERDUE",
  ];
  if (terminalStatuses.includes(ticket.status)) return false;

  const msUntilDeadline = ticket.deadline.getTime() - now.getTime();
  return msUntilDeadline > 0 && msUntilDeadline <= ONE_DAY_MS;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log("[ticket-deadline unit tests]");
  console.log("(pure functions — no DB required)");

  let passed = 0;
  let failed = 0;

  // Helper to create a date in local timezone
  function makeLocalDate(year: number, month: number, day: number, hour: number, min = 0): Date {
    return new Date(year, month - 1, day, hour, min, 0, 0);
  }

  // Helper to create a date at 23:00 UTC on given day
  function makeUtcDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, 23, 0, 0, 0));
  }

  // Test 1: computeDefaultDeadline on Monday 23:00 UTC
  // Monday June 29, 2026. msUntilWeekEnd ≈ 5 days, > 24h => just weekEnd.
  {
    const monday = makeUtcDate(2026, 6, 29); // Monday June 29, 2026
    const result = computeDefaultDeadline(monday);
    const { weekEnd } = getWeekRange(monday);

    // Should be weekEnd since it's Monday and ~5 days to week end
    if (Math.abs(result.getTime() - weekEnd.getTime()) < 1000) {
      pass("computeDefaultDeadline: Monday 23:00 UTC → weekEnd");
      passed++;
    } else {
      fail("computeDefaultDeadline: Monday 23:00 UTC", `expected ~${weekEnd.getTime()}, got ${result.getTime()}`);
      failed++;
    }
  }

  // Test 2: computeDefaultDeadline on Wednesday 23:00 UTC
  // Wednesday July 1, 2026. msUntilWeekEnd ≈ 4 days, > 24h => just weekEnd.
  {
    const wednesday = makeUtcDate(2026, 7, 2); // Wednesday July 1, 2026
    const result = computeDefaultDeadline(wednesday);
    const { weekEnd } = getWeekRange(wednesday);

    if (Math.abs(result.getTime() - weekEnd.getTime()) < 1000) {
      pass("computeDefaultDeadline: Wednesday 23:00 UTC → weekEnd");
      passed++;
    } else {
      fail("computeDefaultDeadline: Wednesday 23:00 UTC", `expected ~${weekEnd.getTime()}, got ${result.getTime()}`);
      failed++;
    }
  }

  // Test 3: C-1 fix — Sunday 23:00 UTC boundary
  // Sunday June 28, 2026. After fix: weekStart = Sunday 00:00, weekEnd = Sunday 23:59:59.
  // msUntilWeekEnd ≈ 1h < 24h => computeDefaultDeadline returns weekEnd + 7 days.
  {
    const sunday = makeUtcDate(2026, 6, 28); // Sunday June 28, 2026
    const result = computeDefaultDeadline(sunday);
    const { weekEnd } = getWeekRange(sunday);
    const expectedMs = weekEnd.getTime() + WEEK_MS;

    if (Math.abs(result.getTime() - expectedMs) < 1000) {
      pass("C-1 Sunday 23:00 UTC → weekEnd + 7 days (C-1 fix)");
      passed++;
    } else {
      fail("C-1 Sunday 23:00 UTC → weekEnd + 7 days", `expected ~${expectedMs}, got ${result.getTime()}`);
      failed++;
    }
  }

  // Test 5: computeDefaultDeadline returns a date AFTER the input
  // Regardless of specific values, result should always be >= input
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const result = computeDefaultDeadline(now);

    if (result.getTime() >= now.getTime()) {
      pass("computeDefaultDeadline: result >= input");
      passed++;
    } else {
      fail("computeDefaultDeadline: result >= input", `result ${result.getTime()} < input ${now.getTime()}`);
      failed++;
    }
  }

  // Test 6: computeDefaultDeadline result is within [weekEnd, weekEnd + 7 days]
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const result = computeDefaultDeadline(now);
    const { weekEnd } = getWeekRange(now);

    const minExpected = weekEnd.getTime();
    const maxExpected = weekEnd.getTime() + WEEK_MS + 1000; // +1s tolerance

    if (result.getTime() >= minExpected && result.getTime() <= maxExpected) {
      pass("computeDefaultDeadline: result in [weekEnd, weekEnd+7days]");
      passed++;
    } else {
      fail("computeDefaultDeadline: result in range", `got ${result.getTime()}, range [${minExpected}, ${maxExpected}]`);
      failed++;
    }
  }

  // Test 5: isOverdue — deadline passed, DEVELOPING status
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-29T10:00:00Z"), // yesterday
      status: "DEVELOPING" as TicketStatus,
    };
    if (isOverdue(ticket, now) === true) {
      pass("isOverdue: deadline passed, DEVELOPING → true");
      passed++;
    } else {
      fail("isOverdue: deadline passed, DEVELOPING", "expected true");
      failed++;
    }
  }

  // Test 6: isOverdue — no deadline set
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = { deadline: null, status: "DEVELOPING" as TicketStatus };
    if (isOverdue(ticket, now) === false) {
      pass("isOverdue: no deadline → false");
      passed++;
    } else {
      fail("isOverdue: no deadline", "expected false");
      failed++;
    }
  }

  // Test 7: isOverdue — deadline in future
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-07-01T10:00:00Z"), // tomorrow
      status: "DEVELOPING" as TicketStatus,
    };
    if (isOverdue(ticket, now) === false) {
      pass("isOverdue: deadline in future → false");
      passed++;
    } else {
      fail("isOverdue: deadline in future", "expected false");
      failed++;
    }
  }

  // Test 8: isOverdue — deadline passed but DONE status
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-29T10:00:00Z"),
      status: "DONE" as TicketStatus,
    };
    if (isOverdue(ticket, now) === false) {
      pass("isOverdue: deadline passed but DONE → false");
      passed++;
    } else {
      fail("isOverdue: deadline passed but DONE", "expected false");
      failed++;
    }
  }

  // Test 9: isOverdue — deadline passed but CLOSED status
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-29T10:00:00Z"),
      status: "CLOSED" as TicketStatus,
    };
    if (isOverdue(ticket, now) === false) {
      pass("isOverdue: deadline passed but CLOSED → false");
      passed++;
    } else {
      fail("isOverdue: deadline passed but CLOSED", "expected false");
      failed++;
    }
  }

  // Test 10: isDeadlineApproaching — within 24 hours
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-30T20:00:00Z"), // 10 hours from now
      status: "DEVELOPING" as TicketStatus,
    };
    if (isDeadlineApproaching(ticket, now) === true) {
      pass("isDeadlineApproaching: within 24h → true");
      passed++;
    } else {
      fail("isDeadlineApproaching: within 24h", "expected true");
      failed++;
    }
  }

  // Test 11: isDeadlineApproaching — more than 24 hours away
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-07-02T10:00:00Z"), // 2 days from now
      status: "DEVELOPING" as TicketStatus,
    };
    if (isDeadlineApproaching(ticket, now) === false) {
      pass("isDeadlineApproaching: more than 24h away → false");
      passed++;
    } else {
      fail("isDeadlineApproaching: more than 24h away", "expected false");
      failed++;
    }
  }

  // Test 12: isDeadlineApproaching — no deadline
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = { deadline: null, status: "DEVELOPING" as TicketStatus };
    if (isDeadlineApproaching(ticket, now) === false) {
      pass("isDeadlineApproaching: no deadline → false");
      passed++;
    } else {
      fail("isDeadlineApproaching: no deadline", "expected false");
      failed++;
    }
  }

  // Test 13: isDeadlineApproaching — DONE status (terminal)
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-30T11:00:00Z"), // 1 hour away
      status: "DONE" as TicketStatus,
    };
    if (isDeadlineApproaching(ticket, now) === false) {
      pass("isDeadlineApproaching: DONE status → false");
      passed++;
    } else {
      fail("isDeadlineApproaching: DONE status", "expected false");
      failed++;
    }
  }

  // Test 14: isDeadlineApproaching — overdue status (terminal)
  {
    const now = new Date("2026-06-30T10:00:00Z");
    const ticket = {
      deadline: new Date("2026-06-29T10:00:00Z"), // already past
      status: "OVERDUE" as TicketStatus,
    };
    if (isDeadlineApproaching(ticket, now) === false) {
      pass("isDeadlineApproaching: OVERDUE status → false");
      passed++;
    } else {
      fail("isDeadlineApproaching: OVERDUE status", "expected false");
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("\n[TICKET DEADLINE UNIT TESTS OK]");
    process.exit(0);
  } else {
    console.log("\n[TICKET DEADLINE UNIT TESTS FAIL]");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
