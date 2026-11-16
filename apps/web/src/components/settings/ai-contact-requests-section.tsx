"use client";

import { PilotBadge, PilotButton, PilotCard } from "@acropora/ui";
import type { AiContactRequestView } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { aiContactRequestsApi } from "@/lib/api/ai-contact-requests";

const CHANNEL_LABEL = { EMAIL: "E-mail", PHONE: "Telefon" } as const;

const time = (iso: string) =>
  new Date(iso).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * A KAPCSOLAT-KÉRÉSEK LISTÁJA (kártya f5b8f7ba, 4c szelet): amit a vevő a csevegésben megadott, és az AI szolgáltatás átadott. A
 * legújabb elöl; a "Kezeltnek jelölöm" gomb a kezelés idejét rögzíti (a megőrzés a kezelt kérést a beállított napig tartja, a
 * kezeletlent legfeljebb a másik beállított napig, utána a kérés törlődik). A lap az elérhetőséget mutatja, mert a kolléga ezen
 * keresi meg a vevőt; a listát csak az `AI_SETTINGS_MANAGE` jog látja (a szerver is ezt kéri).
 *
 * A kezelés egy kattintás, megerősítés nélkül: visszavonhatatlan, de ártalmatlan (csak a megőrzési órát indítja), és a szerver
 * másodszor nem írja át (nem mozdul sem az idő, sem a kezelő).
 */
export function AiContactRequestsSection({ token }: { token: string }) {
  const [requests, setRequests] = useState<AiContactRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await aiContactRequestsApi.list(token));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A kapcsolat-kérések nem tölthetők be.",
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const markHandled = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await aiContactRequestsApi.handled(token, id);
      await load();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "A jelölés nem sikerült.";
      // a kolléga közben már kezelhette (a szerver "nincs ilyen, még nem kezelt kérés"): a lista újratöltődik, hogy a gomb ne maradjon,
      // és a hiba az újratöltés UTÁN íródik ki (a betöltés törli a korábbi hibát)
      await load();
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PilotCard className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-pilot-grey-900">
          Kapcsolat-kérések
        </h2>
        <p className="text-sm text-pilot-grey-600">
          A vevők által a csevegésben megadott elérhetőségek, legújabb elöl. A
          megőrzési idő után a kérés automatikusan törlődik.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {error}
        </p>
      ) : null}
      {requests === null && !error ? (
        <div
          aria-busy="true"
          className="h-16 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {requests !== null && requests.length === 0 ? (
        <p className="text-sm text-pilot-grey-600">Nincs kapcsolat-kérés.</p>
      ) : null}
      {requests && requests.length > 0 ? (
        <ul className="divide-y divide-pilot-grey-100">
          {requests.map((request) => (
            <li
              key={request.id}
              data-testid="contact-request"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="break-words text-sm font-medium text-pilot-grey-900">
                  {CHANNEL_LABEL[request.channel]}: {request.value}
                </p>
                <p className="text-xs text-pilot-grey-500">
                  Beérkezett: {time(request.createdAt)}
                  {request.handledAt
                    ? `, kezelve: ${time(request.handledAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {request.notifiedAt === null ? (
                  <PilotBadge variant="grey">
                    Az értesítő levél nem ment ki
                  </PilotBadge>
                ) : null}
                {request.handledAt ? (
                  <PilotBadge variant="blue">Kezelve</PilotBadge>
                ) : (
                  <PilotButton
                    disabled={busyId !== null}
                    onClick={() => void markHandled(request.id)}
                  >
                    Kezeltnek jelölöm
                  </PilotButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </PilotCard>
  );
}
