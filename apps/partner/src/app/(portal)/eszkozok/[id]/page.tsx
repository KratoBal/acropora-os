import { AssetDetail } from "@/components/asset-detail";

export default async function AssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssetDetail id={id} />;
}
