import type { Metadata } from "next";

import { NewAquarium } from "@/components/aquariums/new-aquarium";

export const metadata: Metadata = { title: "Új akvárium" };

export default function NewAquariumPage() {
  return <NewAquarium />;
}
