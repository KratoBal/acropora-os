import { PilotWorksheetEditorPage } from "@/components/worksheets/pilot/pilot-worksheet-editor-page";

export default async function EditWorksheetRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotWorksheetEditorPage worksheetId={id} />;
}
