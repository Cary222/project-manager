import { prisma } from "@/shared/db/client";

const COUNTER_KEY = "ticketNo";
const INITIAL_TICKET_NO = 10000;

async function getNextTicketNoFromMax() {
  const maxTicket = await prisma.ticket.findFirst({
    orderBy: { ticketNo: "desc" },
    select: { ticketNo: true },
  });

  return (maxTicket?.ticketNo ?? INITIAL_TICKET_NO - 1) + 1;
}

export async function allocateTicketNo() {
  return getNextTicketNoFromMax();
}

export async function syncTicketCounterAfterCreate(ticketNo: number) {
  await prisma.counter.upsert({
    where: { key: COUNTER_KEY },
    update: {
      nextValue: ticketNo + 1,
    },
    create: { key: COUNTER_KEY, nextValue: ticketNo + 1 },
  });
}

export async function syncTicketCounterAfterDelete() {
  const nextValue = await getNextTicketNoFromMax();

  await prisma.counter.upsert({
    where: { key: COUNTER_KEY },
    update: {
      nextValue,
    },
    create: {
      key: COUNTER_KEY,
      nextValue,
    },
  });
}
