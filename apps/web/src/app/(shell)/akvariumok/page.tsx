import { AquariumListPage } from "@/components/aquariums/aquarium-list-page";
import { PilotAquariumListPage } from "@/components/aquariums/pilot/pilot-aquarium-list-page";
import { PilotToggle } from "@/components/aquariums/pilot/pilot-toggle";

export default function AkvariumokPage() {
  return (
    <PilotToggle
      legacy={<AquariumListPage />}
      pilot={<PilotAquariumListPage />}
    />
  );
}
