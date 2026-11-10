import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { RunOutUnsubscribe } from "@/components/runout-unsubscribe";

export const metadata: Metadata = { title: "Leiratkozás az emlékeztetőről" };

export default function RunOutUnsubscribePage() {
  return (
    <AuthCard title="Leiratkozás az emlékeztetőről">
      <RunOutUnsubscribe />
    </AuthCard>
  );
}
