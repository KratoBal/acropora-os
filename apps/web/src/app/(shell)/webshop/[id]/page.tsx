import { WebshopOrderDetailPage } from "@/components/webshop/webshop-order-detail-page";

export default async function WebshopOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WebshopOrderDetailPage orderId={id} />;
}
