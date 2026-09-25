import { PilotPosSaleDetailPage } from "@/components/pos/pilot/pilot-pos-sale-detail-page";

export default async function PosSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotPosSaleDetailPage saleId={id} />;
}
