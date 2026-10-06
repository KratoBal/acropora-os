import { MortalityDetailPage } from "@/components/mortality/mortality-detail-page";

export default async function ElhullasiBejegyzesPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  return <MortalityDetailPage recordId={recordId} />;
}
