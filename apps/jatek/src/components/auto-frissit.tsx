"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A KÖVETKEZŐ ÁLLAPOT MAGÁTÓL JELENIK MEG (Balázs, 2026-11-06): amikor a nyitásig vagy a zárásig tartó visszaszámláló lejár,
 * az oldal újra lekéri az állapotot (`router.refresh()`), tehát az új kérdés oldal-újratöltés nélkül megjelenik. Ha a
 * szerver órája kicsit mögötte jár, és még a régi állapotot adja, ötmásodpercenként újrapróbálja, amíg az állapot meg nem
 * változik (ekkor az oldal új tartalommal rajzolódik, és ez az elem eltűnik vagy új `celIdo`-val jön).
 */
export const FRISSITES_UTANI_MS = 1000;
export const ISMETLES_MS = 5000;
/** A `setTimeout` felső határa 2^31-1 ms (kb. 24,8 nap): távolabbi célnál a határig vár, és újraszámol. */
const TIMEOUT_FELSO_HATAR_MS = 2_000_000_000;

/** Mennyit várjon a következő lépés előtt: a célig hátralévő idő és egy másodperc (a határig), legalább nulla. */
export function varakozasMs(celIdo: string, most: number): number | null {
  const cel = Date.parse(celIdo);
  if (Number.isNaN(cel)) return null;
  return Math.min(
    Math.max(0, cel - most + FRISSITES_UTANI_MS),
    TIMEOUT_FELSO_HATAR_MS,
  );
}

export function AutoFrissit({ celIdo }: { celIdo: string }) {
  const router = useRouter();
  useEffect(() => {
    let ismetles: ReturnType<typeof setInterval> | null = null;
    let var_: ReturnType<typeof setTimeout> | null = null;
    const lep = () => {
      const ms = varakozasMs(celIdo, Date.now());
      if (ms === null) return;
      if (ms >= TIMEOUT_FELSO_HATAR_MS) {
        var_ = setTimeout(lep, TIMEOUT_FELSO_HATAR_MS);
        return;
      }
      var_ = setTimeout(() => {
        router.refresh();
        ismetles = setInterval(() => router.refresh(), ISMETLES_MS);
      }, ms);
    };
    lep();
    return () => {
      if (var_) clearTimeout(var_);
      if (ismetles) clearInterval(ismetles);
    };
  }, [celIdo, router]);
  return null;
}
