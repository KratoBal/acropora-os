import { WorksheetEditorPage } from "@/components/worksheets/worksheet-editor-page";

export default async function EditWorksheetRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorksheetEditorPage worksheetId={id} />;
}
