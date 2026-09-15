"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A STATISZTIKA-CSEMPEK DARABSZAMAI, ALLAPOTONKENT.
 *
 * MIERT TOBB HIVAS ES NEM EGY: a lista-vegpontok EGY lapot adnak vissza, plusz
 * a `pagination.totalItems`-et a SZURT halmazra. Osszesito vegpont ma nincs
 * egyikhez sem. Egy allapot darabszama tehat egy lista-hivas a legkisebb
 * lapmerettel, es a valaszbol csak a `totalItems` erdekel.
 *
 * AMIT EZ KOSTOL, ES AMIT NEM OLD MEG: haromszor annyi keres fut le a lap
 * betoltesekor, es a munkalapoknal mindegyik vegigmegy a `DISTINCT ON`-os
 * legutolso-verzio valogatason. Mai adatmennyisegnel ez olcso, de nem az a
 * vegso alak: egy `GET /service/worksheets/counts` egy hivasbol adna ugyanezt.
 * Az API viszont ebben a korben nem az en hatokorom, ezert all ez itt.
 *
 * A HIBA NEM TORI EL A LAPOT: ha egy szamlalas elhasal, az a csempe `null`
 * marad (gondolatjelet mutat), a lista maga valtozatlanul mukodik. Egy nulla
 * ITT rosszabb lenne a hianynal: azt allitana, hogy nincs ilyen tetel.
 */
export function useServiceStatusCounts<T extends string>({
  enabled,
  cacheKey,
  statuses,
  fetchCount,
}: {
  enabled: boolean;
  /**
   * MINDENT TARTALMAZNIA KELL, AMITOL A SZAMLALAS FUGG (token, alap-szurok).
   * A `fetchCount` szandekosan NEM fuggosege az effektnek -- minden renderen
   * uj fuggveny keletkezne beloli, es a szamlalas vegtelen korbe kerulne.
   * Cserebe a frissesseget ez a kulcs hordozza: ami nincs benne, arra nem
   * szamolunk ujra.
   */
  cacheKey: string;
  statuses: readonly T[];
  fetchCount: (status: T, signal: AbortSignal) => Promise<number>;
}): Partial<Record<T, number>> {
  const [counts, setCounts] = useState<Partial<Record<T, number>>>({});
  const fetchRef = useRef(fetchCount);
  fetchRef.current = fetchCount;
  const statusKey = statuses.join(",");

  useEffect(() => {
    if (!enabled) {
      setCounts({});
      return;
    }
    const controller = new AbortController();
    const list = statusKey.split(",") as T[];
    setCounts({});
    for (const status of list) {
      void fetchRef
        .current(status, controller.signal)
        .then((total) => {
          if (controller.signal.aborted) return;
          setCounts((previous) => ({ ...previous, [status]: total }));
        })
        .catch(() => {
          // Szandekosan nema: a csempe `null` marad, a lista megy tovabb.
        });
    }
    return () => controller.abort();
  }, [cacheKey, enabled, statusKey]);

  return counts;
}
