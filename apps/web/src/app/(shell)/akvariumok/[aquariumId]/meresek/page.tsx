import { PilotMeasurementHistoryPage } from "@/components/aquariums/pilot/pilot-measurement-history-page";

export default async function AkvariumMeresiElozmenyekPage({
  params,
}: {
  params: Promise<{ aquariumId: string }>;
}) {
  const { aquariumId } = await params;
  return <PilotMeasurementHistoryPage aquariumId={aquariumId} />;
}
