import { AppShell } from "@/shared/ui/AppShell";
import { TicketDetail } from "@/features/ticket/ui/ticket-detail/TicketDetail";
import { DispatchTicketDetailHeader } from "./DispatchTicketDetailHeader";

export default async function DispatchTicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return (
    <AppShell header={<DispatchTicketDetailHeader ticketId={ticketId} />}>
      <TicketDetail ticketId={ticketId} />
    </AppShell>
  );
}
