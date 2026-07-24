import { NavIncomingInvoiceDetailPage } from "@/components/purchasing/nav-incoming-invoice-detail-page";

export default async function NavSzamlaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NavIncomingInvoiceDetailPage navInvoiceId={id} />;
}
