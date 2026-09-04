import { WorksheetEntryPage } from "@/components/worksheets/worksheet-entry-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  return <WorksheetEntryPage worksheetId={id} entryId={entryId} />;
}
