import { WorksheetDetail } from "@/components/worksheet-detail";

export default async function WorksheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorksheetDetail id={id} />;
}
