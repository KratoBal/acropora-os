import { CompletionCertificateDetail } from "@/components/completion-certificate-detail";

export default async function CompletionCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompletionCertificateDetail id={id} />;
}
