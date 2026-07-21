import { PosSaleDetailPage } from "@/components/pos/pos-sale-detail-page";

export default async function PosSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PosSaleDetailPage saleId={id} />;
}
