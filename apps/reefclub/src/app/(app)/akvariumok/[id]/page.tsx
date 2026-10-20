import type { Metadata } from "next";

import { AquariumDetail } from "@/components/aquariums/aquarium-detail";

export const metadata: Metadata = { title: "Akvárium" };

export default async function AquariumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AquariumDetail id={id} />;
}
