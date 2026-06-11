import dynamic from "next/dynamic";
import { TicketsListLoading, TicketsListHeaderSkeleton } from "@/components/TicketsList";

const TicketsList = dynamic(
  () => import("@/components/TicketsList").then((mod) => mod.TicketsList),
  {
    loading: () => <TicketsListLoading />,
  }
);

export default function TicketsPage() {
  return <TicketsList />;
}
