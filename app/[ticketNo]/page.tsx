import { TicketDetail } from "@/components/TicketDetail";

export const dynamic = "force-dynamic";

export default async function TicketNoPage({
  params,
}: {
  params: Promise<{ ticketNo: string }>;
}) {
  const { ticketNo } = await params;
  return <TicketDetail ticketId={ticketNo} />;
}
