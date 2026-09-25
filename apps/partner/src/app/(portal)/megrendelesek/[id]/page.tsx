import { MaintenanceOrderDetail } from "@/components/maintenance-order-detail";

export default async function MaintenanceOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MaintenanceOrderDetail id={id} />;
}
