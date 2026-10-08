import { QuoteTemplateEditorPage } from "@/components/quotes/quote-template-editor-page";

export default async function AjanlatSablonPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <QuoteTemplateEditorPage templateId={templateId} />;
}
