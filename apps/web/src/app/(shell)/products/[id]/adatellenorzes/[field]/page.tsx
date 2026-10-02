import { JevConflictPage } from "@/components/jev-product-intelligence/jev-conflict-page";

export default async function ProductFieldConflictPage({
  params,
}: {
  params: Promise<{ id: string; field: string }>;
}) {
  const { id, field } = await params;
  return <JevConflictPage productId={id} field={field} />;
}
