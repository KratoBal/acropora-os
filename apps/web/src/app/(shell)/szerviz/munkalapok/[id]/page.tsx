import { PilotWorksheetDetailPage } from "@/components/worksheets/pilot/pilot-worksheet-detail-page";

export default async function WorksheetDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotWorksheetDetailPage worksheetId={id} />;
}
