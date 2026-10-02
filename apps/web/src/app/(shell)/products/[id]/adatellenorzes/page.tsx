import { JevProductReviewPage } from "@/components/jev-product-intelligence/jev-product-review-page";

export default async function ProductDataReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JevProductReviewPage productId={id} />;
}
