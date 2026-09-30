import { BillingDocumentEditor } from "@/components/billing/billing-document-editor";

export default async function BillingDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BillingDocumentEditor documentId={id} />;
}
