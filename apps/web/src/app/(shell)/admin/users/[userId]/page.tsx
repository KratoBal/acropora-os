import { UserEditorPage } from "@/components/users/user-editor-page";
export default async function UserPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <UserEditorPage userId={userId} />;
}
