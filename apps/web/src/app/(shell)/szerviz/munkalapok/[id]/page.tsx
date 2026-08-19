import { WorksheetDetailPage } from "@/components/worksheets/worksheet-detail-page";

export default async function WorksheetDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorksheetDetailPage worksheetId={id} />;
}
