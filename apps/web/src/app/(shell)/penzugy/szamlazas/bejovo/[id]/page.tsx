import { BillingIncomingDocumentPage } from "@/components/billing/billing-incoming-document-page";

export default async function BillingIncomingDocument({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BillingIncomingDocumentPage documentId={id} />;
}
