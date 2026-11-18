import { TicketList } from "@/components/ticket-list";

/** A KARBANTARTÁS menüpont listája (Luca, 2026-11-18 14:50 UTC; acrobot 55980): a partner karbantartási lapjai, a hibajegyektől külön. */
export default function MaintenancePage() {
  return <TicketList kind="MAINTENANCE" />;
}
