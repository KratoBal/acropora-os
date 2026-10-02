import { MaterialRequestDetailPage } from "@/components/material-requests/material-request-overview-page";

export default async function MaterialRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MaterialRequestDetailPage id={id} />;
}
