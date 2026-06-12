import dynamic from "next/dynamic";
import { TicketsListLoading, TicketsListHeaderSkeleton } from "@/components/ticket/TicketsList";

const TicketsList = dynamic(
  () => import("@/components/ticket/TicketsList").then((mod) => mod.TicketsList),
  {
    loading: () => <TicketsListLoading />,
  }
);

export default function TicketsPage() {
  return <TicketsList />;
}
