import { AquariumDetail } from "@/components/aquarium-detail";

export default async function AquariumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AquariumDetail id={id} />;
}
