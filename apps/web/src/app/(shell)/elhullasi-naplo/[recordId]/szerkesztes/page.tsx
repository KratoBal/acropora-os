import { MortalityFormPage } from "@/components/mortality/mortality-form-page";

export default async function ElhullasiBejegyzesModositasaPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  return <MortalityFormPage recordId={recordId} />;
}
