import { AquariumMeasurementHistory } from "@/components/aquarium-measurement-history";

export default async function AquariumMeasurementHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AquariumMeasurementHistory aquariumId={id} />;
}
