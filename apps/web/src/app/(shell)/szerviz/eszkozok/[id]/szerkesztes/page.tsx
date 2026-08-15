import { AssetEditorPage } from "@/components/service-assets/asset-editor-page";

export default async function EditAssetRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssetEditorPage assetId={id} />;
}
