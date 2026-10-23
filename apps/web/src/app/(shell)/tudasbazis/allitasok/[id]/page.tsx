import { ClaimDetailPage } from "@/components/knowledge-base/claim-store-page";

export default async function ClaimDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClaimDetailPage claimId={id} />;
}
