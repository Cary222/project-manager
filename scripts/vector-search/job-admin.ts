/**
 * job-admin.ts — IndexJob 管理 CLI
 *
 * 用法:
 *   npx tsx scripts/vector-search/job-admin.ts status
 *   npx tsx scripts/vector-search/job-admin.ts inspect <noteId>
 *   npx tsx scripts/vector-search/job-admin.ts retry <jobId>
 *   npx tsx scripts/vector-search/job-admin.ts retry-note <noteId>
 *   npx tsx scripts/vector-search/job-admin.ts clear-pending
 *   npx tsx scripts/vector-search/job-admin.ts purge-completed [--older-than-days=N]
 */
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function status() {
  const [pending, processing, completed, failed] = await Promise.all([
    prisma.indexJob.count({ where: { status: "PENDING" } }),
    prisma.indexJob.count({ where: { status: "PROCESSING" } }),
    prisma.indexJob.count({ where: { status: "COMPLETED" } }),
    prisma.indexJob.count({ where: { status: "FAILED" } }),
  ]);

  const oldestPending = await prisma.indexJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, noteId: true, createdAt: true, attempt: true },
  });

  const recentFailed = await prisma.indexJob.findMany({
    where: { status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, noteId: true, error: true, updatedAt: true },
  });

  console.log("=== IndexJob Queue Status ===");
  console.log(`PENDING:    ${pending}`);
  console.log(`PROCESSING: ${processing}`);
  console.log(`COMPLETED:  ${completed}`);
  console.log(`FAILED:     ${failed}`);

  if (oldestPending) {
    console.log(
      `\nOldest PENDING: ${oldestPending.id} note=${oldestPending.noteId} age=${Math.round((Date.now() - oldestPending.createdAt.getTime()) / 1000)}s attempt=${oldestPending.attempt}`,
    );
  }

  if (recentFailed.length > 0) {
    console.log("\nRecent FAILED:");
    for (const j of recentFailed) {
      console.log(`  ${j.id} note=${j.noteId} err=${j.error?.slice(0, 80)}`);
    }
  }
}

async function inspectNote(noteId: string) {
  const jobs = await prisma.indexJob.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (jobs.length === 0) {
    console.log(`no jobs for note ${noteId}`);
    return;
  }
  console.log(`=== Jobs for note ${noteId} (latest 10) ===`);
  for (const j of jobs) {
    console.log(
      `  ${j.id} status=${j.status} attempt=${j.attempt}/${j.maxAttempts} err=${j.error?.slice(0, 60) ?? "-"}`,
    );
  }
}

async function retryJob(jobId: string) {
  const job = await prisma.indexJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error(`job ${jobId} not found`);
    process.exitCode = 1;
    return;
  }
  await prisma.indexJob.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      attempt: 0,
      error: null,
      startedAt: null,
      updatedAt: new Date(),
    },
  });
  console.log(`✅ reset job ${jobId} (note=${job.noteId}) to PENDING`);
}

async function retryNote(noteId: string) {
  const { count } = await prisma.indexJob.updateMany({
    where: { noteId, status: { in: ["FAILED", "PROCESSING"] } },
    data: {
      status: "PENDING",
      attempt: 0,
      error: null,
      startedAt: null,
      updatedAt: new Date(),
    },
  });
  console.log(`✅ reset ${count} jobs for note ${noteId} to PENDING`);
}

async function clearPending() {
  const { count } = await prisma.indexJob.deleteMany({
    where: { status: "PENDING" },
  });
  console.log(`✅ deleted ${count} PENDING jobs`);
}

async function purgeCompleted(args: ParsedArgs) {
  const daysRaw = args.flags["older-than-days"];
  const days = typeof daysRaw === "string" ? Number.parseInt(daysRaw, 10) : 7;
  if (!Number.isFinite(days) || days <= 0) {
    console.error("invalid --older-than-days");
    process.exitCode = 1;
    return;
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.indexJob.deleteMany({
    where: {
      status: "COMPLETED",
      updatedAt: { lt: cutoff },
    },
  });
  console.log(`✅ deleted ${count} COMPLETED jobs older than ${days} days`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.positional[0];

  try {
    switch (cmd) {
      case "status":
        await status();
        break;
      case "inspect":
        if (!args.positional[1]) throw new Error("usage: inspect <noteId>");
        await inspectNote(args.positional[1]);
        break;
      case "retry":
        if (!args.positional[1]) throw new Error("usage: retry <jobId>");
        await retryJob(args.positional[1]);
        break;
      case "retry-note":
        if (!args.positional[1]) throw new Error("usage: retry-note <noteId>");
        await retryNote(args.positional[1]);
        break;
      case "clear-pending":
        await clearPending();
        break;
      case "purge-completed":
        await purgeCompleted(args);
        break;
      default:
        console.log(`Usage: job-admin <command> [args]

Commands:
  status                          Show queue counts (PENDING/PROCESSING/COMPLETED/FAILED)
  inspect <noteId>                Show latest 10 jobs for a note
  retry <jobId>                   Reset a FAILED/PROCESSING job back to PENDING (attempt=0)
  retry-note <noteId>             Reset all FAILED/PROCESSING jobs for a note
  clear-pending                   Delete all PENDING jobs (慎用)
  purge-completed [--older-than-days=N]  Delete COMPLETED jobs older than N days (default 7)
`);
        process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
