import { prisma } from "@/lib/db";

const COUNTER_KEY = "ticketNo";
const INITIAL_TICKET_NO = 10000;

export async function allocateTicketNo() {
  const ticketNo = await prisma.$transaction(async (tx) => {
    const current = await tx.counter.upsert({
      where: { key: COUNTER_KEY },
      update: {},
      create: { key: COUNTER_KEY, nextValue: INITIAL_TICKET_NO },
    });

    await tx.counter.update({
      where: { key: COUNTER_KEY },
      data: { nextValue: current.nextValue + 1 },
    });

    return current.nextValue;
  });

  return ticketNo;
}
