import { Suspense } from "react";

import { AuthGate } from "@/components/auth/auth-gate";
import { LiveDrawPage } from "@/components/game/live-draw-page";

/**
 * AZ ÉLŐ SORSOLÁS OLDALA (nyereményjáték, kártya 31445d0f): a shell-en KÍVÜL, hogy a menü és az oldalsáv ne kerüljön
 * az élő adásba. A bejelentkezést ugyanaz a kapu védi, mint a shellt; a jogosultságot (game.manage) a szerver és az oldal
 * is ellenőrzi.
 */
export default function LiveDrawRoute() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <LiveDrawPage />
      </Suspense>
    </AuthGate>
  );
}
