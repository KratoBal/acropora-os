import { UnasBrandReviewPage } from "@/components/imports/unas-brand-review-page";

export default async function BrandReviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return <UnasBrandReviewPage batchId={batchId} />;
}
