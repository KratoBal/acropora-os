import { OperationsTemplateEditorPage } from "@/components/operations-log/operations-template-editor-page";

export default async function UzemeltetesiNaploSablonPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <OperationsTemplateEditorPage templateId={templateId} />;
}
