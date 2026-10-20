import type { Metadata } from "next";

import { AquariumList } from "@/components/aquariums/aquarium-list";

export const metadata: Metadata = { title: "Akváriumok" };

export default function AquariumsPage() {
  return <AquariumList />;
}
