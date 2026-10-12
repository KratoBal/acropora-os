import { SeoLandingEditorPage } from "@/components/seo-landing/seo-landing-editor-page";
export default async function SeoLandingPage({
  params,
}: {
  params: Promise<{ landingId: string }>;
}) {
  const { landingId } = await params;
  return <SeoLandingEditorPage landingId={landingId} />;
}
