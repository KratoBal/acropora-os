import { AssetDetailPage } from "@/components/service-assets/asset-detail-page";

export default async function ServiceAssetDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssetDetailPage assetId={id} />;
}
