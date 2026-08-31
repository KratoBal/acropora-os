"use client";

import type { WorksheetAssignableUser } from "@acropora/types";
import { useEffect, useState } from "react";

import { worksheetsApi } from "@/lib/api/worksheets";

/**
 * A FELELŐS-VÁLASZTÓ, KÉT KÉPERNYŐ KÖZÖS RÉSZE.
 *
 * A kiosztás eddig csak a részletek oldalon létezett, ahol egy MEGLÉVŐ lapot
 * lehet átírni. A felvitelkor viszont már ismert, ki megy ki - az iroda nyit
 * lapot a szerelőnek -, és a két helyen ugyanaz a lista, ugyanazokkal a
 * szabályokkal: aki választható, az aktív kolléga, akinek a szerepköre engedi a
 * lap szerkesztését.
 *
 * Ezért a VÁLASZTÓ áll külön, és nem a mentés: a felvitelnél a felelősök a
 * létrehozás payloadjának részei (egy tranzakció), a részletek oldalon pedig
 * saját mentés-gomb küldi őket. A kettő nem ugyanaz a művelet, és összevonva az
 * egyik oldalon mindig hazudna a gomb.
 */

export function useAssignableUsers(token: string, enabled: boolean) {
  const [candidates, setCandidates] = useState<WorksheetAssignableUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    worksheetsApi
      .assignableUsers(token, controller.signal)
      .then((response) => setCandidates(response.items))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("A kollégák listája nem tölthető be.");
      });
    return () => controller.abort();
  }, [enabled, token]);

  return { candidates, error };
}

export interface WorksheetAssigneePickerProps {
  candidates: WorksheetAssignableUser[];
  selected: string[];
  onToggle: (userId: string) => void;
}

export function WorksheetAssigneePicker({
  candidates,
  selected,
  onToggle,
}: WorksheetAssigneePickerProps) {
  /*
   * AZ ÜRES LISTA KI VAN MONDVA. Egy üres doboz a "Felelősök" felirat alatt úgy
   * néz ki, mintha a betöltés akadt volna el, és a felvivő megvárná - holott
   * ilyenkor tényleg nincs kit választani.
   */
  if (candidates.length === 0)
    return (
      <p className="text-sm text-slate-500">
        Nincs olyan kolléga, akire a lap kiosztható lenne.
      </p>
    );

  return (
    <div className="space-y-1">
      {candidates.map((candidate) => (
        <label key={candidate.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(candidate.id)}
            onChange={() => onToggle(candidate.id)}
          />
          {candidate.name}
        </label>
      ))}
    </div>
  );
}

/** A kijelölés váltása, egy helyen: a két képernyő ugyanazt a listát szerkeszti. */
export function toggleAssignee(selected: string[], userId: string): string[] {
  return selected.includes(userId)
    ? selected.filter((id) => id !== userId)
    : [...selected, userId];
}
