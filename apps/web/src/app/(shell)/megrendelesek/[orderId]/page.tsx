import { PartnerOrderDetailPage } from "@/components/partner-orders/partner-order-detail-page";

export default async function MegrendelesPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <PartnerOrderDetailPage orderId={orderId} />;
}
