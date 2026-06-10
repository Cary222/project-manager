import { TicketDetail } from "@/components/ticket-detail";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return <TicketDetail ticketId={ticketId} />;
}
