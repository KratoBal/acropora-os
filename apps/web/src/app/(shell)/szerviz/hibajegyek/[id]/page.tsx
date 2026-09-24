import { PilotServiceJobDetailPage } from "@/components/service-jobs/pilot/pilot-service-job-detail-page";

export default async function ServiceJobDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PilotServiceJobDetailPage jobId={id} />;
}
