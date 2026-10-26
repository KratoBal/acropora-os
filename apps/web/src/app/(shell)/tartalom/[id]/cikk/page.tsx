import { ArticleEditorPage } from "@/components/content/article-editor-page";

export default async function ArticleEditorRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ArticleEditorPage contentId={id} />;
}
