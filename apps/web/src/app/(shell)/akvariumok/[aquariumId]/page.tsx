import { AquariumEditorPage } from "@/components/aquariums/aquarium-editor-page";
import { PilotAquariumEditorPage } from "@/components/aquariums/pilot/pilot-aquarium-editor-page";
import { PilotToggle } from "@/components/aquariums/pilot/pilot-toggle";

export default async function AkvariumPage({
  params,
}: {
  params: Promise<{ aquariumId: string }>;
}) {
  const { aquariumId } = await params;
  return (
    <PilotToggle
      legacy={<AquariumEditorPage aquariumId={aquariumId} />}
      pilot={<PilotAquariumEditorPage aquariumId={aquariumId} />}
    />
  );
}
