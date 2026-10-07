import { BillingIncomingReviewPage } from "@/components/billing/billing-incoming-review-page";

export default async function BillingIncomingReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // a lista azonosítója `mailbox:<id>`, az útvonalban kódolva áll
  return <BillingIncomingReviewPage itemId={decodeURIComponent(id)} />;
}
