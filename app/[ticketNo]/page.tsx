import dynamic from "next/dynamic";
import { TicketDetailLoading } from "@/components/ticket-detail";

const TicketDetail = dynamic(
  () => import("@/components/ticket-detail").then((mod) => mod.TicketDetail),
  {
    loading: () => <TicketDetailLoading />,
  }
);

export default async function TicketNoPage({
  params,
}: {
  params: Promise<{ ticketNo: string }>;
}) {
  const { ticketNo } = await params;
  return <TicketDetail ticketId={ticketNo} />;
}
