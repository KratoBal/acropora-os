import { PurchaseInvoiceDetailPage } from "@/components/purchasing/purchase-invoice-detail-page";

export default async function PurchaseInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseInvoiceDetailPage invoiceId={id} />;
}
