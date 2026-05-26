import assert from "node:assert/strict";
import { parseTicketCommitSubject } from "../lib/git-sync/parse";
import { allocateTicketNo } from "../lib/ticket-counter";
import { prisma } from "../lib/db";

async function testParse() {
  assert.equal(parseTicketCommitSubject("10001: 修复登录")?.ticketNo, 10001);
  assert.equal(parseTicketCommitSubject("10002：新增模块")?.ticketNo, 10002);
  assert.equal(parseTicketCommitSubject("feat: no ticket"), null);
}

async function testTicketCounter() {
  const a = await allocateTicketNo();
  const b = await allocateTicketNo();
  assert.ok(b > a, "ticket numbers should increase");
}

async function testUsersSeeded() {
  const root = await prisma.user.findUnique({ where: { email: "root@example.com" } });
  const user = await prisma.user.findUnique({ where: { email: "user@example.com" } });
  assert.equal(root?.role, "ROOT");
  assert.equal(user?.role, "USER");
}

async function main() {
  await testParse();
  await testTicketCounter();
  await testUsersSeeded();
  console.log("acceptance tests passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
