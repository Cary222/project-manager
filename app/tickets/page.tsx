import dynamic from "next/dynamic";
import { TicketsListLoading, TicketsListHeaderSkeleton } from "@/features/ticket/ui/TicketsList";

const TicketsList = dynamic(
  () => import("@/features/ticket/ui/TicketsList").then((mod) => mod.TicketsList),
  {
    loading: () => <TicketsListLoading />,
  }
);

export default function TicketsPage() {
  return <TicketsList />;
}
