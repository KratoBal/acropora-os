"use client";

import { useEffect } from "react";

/**
 * A KÖVETKEZŐ ÁLLAPOT MAGÁTÓL JELENIK MEG (Balázs, 2026-11-06): amikor a nyitásig vagy a zárásig tartó visszaszámláló
 * lejár, az oldal újratölti magát, és az új kérdés kézi frissítés nélkül megjelenik (a lejárt állapotú kártyán nincs mit
 * szerkeszteni, tehát nincs mit elveszíteni). Ha a szerver órája kicsit mögötte jár, és az újratöltés még a régi állapotot
 * adja, a cél már elmúlt: ilyenkor `ISMETLES_MS` múlva próbálja újra, nem másodpercenként, hogy ne terhelje a szervert.
 */
export const FRISSITES_UTANI_MS = 1000;
export const ISMETLES_MS = 5000;
/** A `setTimeout` felső határa 2^31-1 ms (kb. 24,8 nap): távolabbi célnál a határig vár, és újraszámol. */
const TIMEOUT_FELSO_HATAR_MS = 2_000_000_000;

/**
 * Mennyi ideig várjon az újratöltésig: a célig hátralévő idő és egy másodperc; ha a cél már elmúlt (az újratöltés még
 * a régi állapotot hozta), `ISMETLES_MS`. `null`, ha a cél nem idő. A `setTimeout` határáig korlátozva.
 */
export function varakozasMs(celIdo: string, most: number): number | null {
  const cel = Date.parse(celIdo);
  if (Number.isNaN(cel)) return null;
  const hatra = cel - most;
  return Math.min(
    hatra > 0 ? hatra + FRISSITES_UTANI_MS : ISMETLES_MS,
    TIMEOUT_FELSO_HATAR_MS,
  );
}

export function AutoFrissit({ celIdo }: { celIdo: string }) {
  useEffect(() => {
    const ms = varakozasMs(celIdo, Date.now());
    if (ms === null) return;
    const idozito = setTimeout(
      // a határig várt (távoli) cél nem újratölt, csak újraszámol: az effekt a következő renderelésnél indul újra
      () => {
        if (Date.parse(celIdo) - Date.now() > TIMEOUT_FELSO_HATAR_MS) return;
        window.location.reload();
      },
      ms,
    );
    return () => clearTimeout(idozito);
  }, [celIdo]);
  return null;
}
