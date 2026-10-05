import { WebshopOrderDetailPage } from "@/components/webshop-orders/webshop-order-detail-page";

export default async function WebshopNewOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WebshopOrderDetailPage id={id} />;
}
