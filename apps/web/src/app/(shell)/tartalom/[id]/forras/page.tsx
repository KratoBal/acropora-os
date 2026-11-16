import { TeachingSourcePage } from "@/components/content/teaching-source-page";

export default async function TeachingSourceRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeachingSourcePage contentId={id} />;
}
