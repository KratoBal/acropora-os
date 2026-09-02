"use client";

import { Input } from "@acropora/ui";
import type { CustomerSummary } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { customersApi } from "@/lib/api/customers";

/**
 * PARTNER-VÁLASZTÓ, KÖZÖS, KÉT KÉPERNYŐNEK.
 *
 * KERES, NEM LISTÁZ: a vevő-lista lapozott, és egy oldal legfeljebb százat ad.
 * Egy sima legördülő CSENDBEN levágná a többit, és a hiányzó partner úgy nézne
 * ki, mintha nem is létezne.
 *
 * ÉS AZÉRT EGY KOMPONENS, NEM KETTŐ: a küszöb, a késleltetés és az, hogy egy
 * hibás keresés nem állítja meg a képernyőt, mind SZABÁLY. Két példányban egyszer
 * elcsúsznának, és a különbség néma lenne - az egyik képernyő két betűtől
 * keresne, a másik egytől, és senki nem venné észre.
 */
export function PartnerPicker({
  id,
  onPick,
}: {
  id: string;
  onPick: (customer: CustomerSummary) => void;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<CustomerSummary[]>([]);

  const find = useCallback(
    async (text: string, signal?: AbortSignal) => {
      // KÉT KARAKTER ALATT NEM KÉRDEZ: egyetlen leütés nem hozza le a fél könyvet.
      if (text.trim().length < 2) {
        setMatches([]);
        return;
      }
      const query = new URLSearchParams({
        search: text.trim(),
        page: "1",
        pageSize: "10",
      });
      try {
        const response = await customersApi.list(token, query, signal);
        setMatches(response.items);
      } catch {
        // A KERESÉS HIBÁJA NEM ÁLLÍTJA MEG A KÉPERNYŐT.
        setMatches([]);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void find(search, controller.signal),
      300,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [find, search]);

  return (
    <>
      <Input
        id={id}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Kezdd el gépelni a partner nevét"
      />
      {matches.length ? (
        <ul className="space-y-1 pt-1 text-sm">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                className="underline hover:text-teal-700"
                onClick={() => onPick(match)}
              >
                {match.displayName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
