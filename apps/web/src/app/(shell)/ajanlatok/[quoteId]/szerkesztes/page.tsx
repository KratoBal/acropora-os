import { QuoteEditorPage } from "@/components/quotes/quote-editor-page";

export default async function AjanlatSzerkesztesPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId } = await params;
  return <QuoteEditorPage quoteId={quoteId} />;
}
