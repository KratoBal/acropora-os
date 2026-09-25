import { PilotSupplierEditorPage } from "@/components/suppliers/pilot/pilot-supplier-editor-page";
export default async function PartnerPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  return <PilotSupplierEditorPage supplierId={supplierId} />;
}
