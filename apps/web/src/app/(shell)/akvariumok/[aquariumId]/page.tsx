import { AquariumEditorPage } from "@/components/aquariums/aquarium-editor-page";
export default async function AkvariumPage({
  params,
}: {
  params: Promise<{ aquariumId: string }>;
}) {
  const { aquariumId } = await params;
  return <AquariumEditorPage aquariumId={aquariumId} />;
}
