import { QuoteDetailPage } from "@/components/quotes/quote-detail-page";

export default async function AjanlatPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId } = await params;
  return <QuoteDetailPage quoteId={quoteId} />;
}
