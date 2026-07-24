import { SupplierEditorPage } from "@/components/suppliers/supplier-editor-page";
export default async function PartnerPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  return <SupplierEditorPage supplierId={supplierId} />;
}
