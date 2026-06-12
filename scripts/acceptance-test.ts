import assert from "node:assert/strict";
import { parseTicketCommitSubject } from "../entities/ticket/lib/parse-commit";
import { allocateTicketNo } from "@/entities/ticket/lib/ticket-counter";
import { prisma } from "@/shared/db/client";

async function testParse() {
  assert.equal(parseTicketCommitSubject("10001: 修复登录")?.ticketNo, 10001);
  assert.equal(parseTicketCommitSubject("10002：新增模块")?.ticketNo, 10002);
  assert.equal(parseTicketCommitSubject("10008")?.ticketNo, 10008);
  assert.equal(parseTicketCommitSubject("#10008")?.ticketNo, 10008);
  assert.equal(
    parseTicketCommitSubject(
      "#10013 feat(TextureImport): 为 Figma 资源添加纹理导入设置"
    )?.ticketNo,
    10013
  );
  assert.equal(parseTicketCommitSubject("10013 unity主页面")?.ticketNo, 10013);
  assert.equal(parseTicketCommitSubject("feat: no ticket"), null);
  assert.equal(parseTicketCommitSubject("1008"), null);
}

async function testTicketCounter() {
  const a = await allocateTicketNo();
  const b = await allocateTicketNo();
  assert.ok(b > a, "ticket numbers should increase");
}

async function testCounterSeeded() {
  const counter = await prisma.counter.findUnique({ where: { key: "ticketNo" } });
  assert.ok(counter && counter.nextValue >= 10000);
}

async function main() {
  await testParse();
  await testTicketCounter();
  await testCounterSeeded();
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
