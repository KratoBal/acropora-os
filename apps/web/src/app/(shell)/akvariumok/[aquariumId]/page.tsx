import { PilotAquariumEditorPage } from "@/components/aquariums/pilot/pilot-aquarium-editor-page";

export default async function AkvariumPage({
  params,
}: {
  params: Promise<{ aquariumId: string }>;
}) {
  const { aquariumId } = await params;
  return <PilotAquariumEditorPage aquariumId={aquariumId} />;
}
