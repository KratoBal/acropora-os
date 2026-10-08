import { QuotePdfPage } from "@/components/quotes/quote-pdf-page";

export default async function AjanlatPdfPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId } = await params;
  return <QuotePdfPage quoteId={quoteId} />;
}
