import { PilotContractDetailPage } from "@/components/contracts/pilot/pilot-contract-detail-page";

export default async function ContractDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotContractDetailPage contractId={id} />;
}
