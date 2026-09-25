import { PilotAssetDetailPage } from "@/components/service-assets/pilot/pilot-asset-detail-page";

export default async function ServiceAssetDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotAssetDetailPage assetId={id} />;
}
