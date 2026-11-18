import { PilotServiceJobDetailPage } from "@/components/service-jobs/pilot/pilot-service-job-detail-page";

/**
 * A KARBANTARTÁSI LAP ADATLAPJA (Balázs és Luca, 2026-11-18): ugyanaz az adatlap-komponens, mint a hibajegyé, de a karbantartási lap
 * NEM hibajegy: a Karbantartás menüpont alatt áll, és a lap a hibajegy-állapotgép nélkül jelenik meg (lásd a komponens fejlécét). A
 * `/szerviz/hibajegyek/[id]` útvonal a karbantartási lapot ide irányítja át, tehát minden régi link tovább működik.
 */
export default async function MaintenanceSheetRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotServiceJobDetailPage jobId={id} route="karbantartas" />;
}
