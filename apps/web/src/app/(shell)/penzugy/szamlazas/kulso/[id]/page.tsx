import { BillingExternalDocumentPage } from "@/components/billing/billing-external-document-page";

export default async function BillingExternalDocument({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BillingExternalDocumentPage documentId={id} />;
}
