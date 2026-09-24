import { AquariumEditorPage } from "@/components/aquariums/aquarium-editor-page";
import { PilotAquariumEditorPage } from "@/components/aquariums/pilot/pilot-aquarium-editor-page";
import { PilotToggle } from "@/components/aquariums/pilot/pilot-toggle";

export default function UjAkvariumPage() {
  return (
    <PilotToggle
      legacy={<AquariumEditorPage />}
      pilot={<PilotAquariumEditorPage />}
    />
  );
}
