import { BillingDocumentDetailPage } from "@/components/billing/billing-document-detail-page";

export default async function BillingDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BillingDocumentDetailPage documentId={id} />;
}
