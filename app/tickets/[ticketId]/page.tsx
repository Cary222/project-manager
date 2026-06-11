import { TicketDetailClient } from "./TicketDetailClient";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return <TicketDetailClient ticketId={ticketId} />;
}
