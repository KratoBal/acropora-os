import { BrandEditorPage } from "@/components/brands/brand-editor-page";
export default async function BrandPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  return <BrandEditorPage brandId={brandId} />;
}
