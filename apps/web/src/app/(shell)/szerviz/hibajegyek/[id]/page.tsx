import { ServiceJobDetailPage } from "@/components/service-jobs/service-job-detail-page";

export default async function ServiceJobDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServiceJobDetailPage jobId={id} />;
}
