"use client";

import { Alert, Skeleton, Textarea, PilotButton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetEntryDetail,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";
import { PilotCard, PilotCardHeader } from "@/components/pilot/pilot-ui";

import { worksheetEntryByline } from "./worksheet-entry-presentation";

/**
 * A MUNKALAP MUNKANAPLOJA A WEBEN.
 *
 * Balazs kerese, 2026-09-03: ugyanazok a funkciok kellenek ide is, mint a
 * telefonra -- bejegyzes gomb, szabad szoveg, rogzites, lista, es egy sorra
 * kattintva kulon lap.
 *
 * === A SZERKESZTES JOGA A SZERVERTOL JON ===
 *
 * A `canEdit` es az `editRefusal` a valaszban all. A felulet NEM szamolja
 * ujra: a szabaly (a lap keszitoje vagy a hibajegy letrehozoja szerkeszthet)
 * jogosultsagi szabaly, es a szerver a KEREST is elutasitja. Ket masolat
 * ugyanarra a szabalyra elcsuszhatna.
 *
 * === A MEZO A GOMBRA NYILIK, NEM ALL OTT MINDIG ===
 *
 * Balazs igy kerte, es van oka: egy allando szovegdoboz minden lapon ott
 * allna, es a lap tobbi reszet nyomna el.
 */
export function WorksheetEntries({
  worksheetId,
  canWrite,
}: {
  worksheetId: string;
  canWrite: boolean;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const [entries, setEntries] = useState<WorksheetEntryDetail[] | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    /*
      A KAPU A MUNKAMENETRE ES A JOGRA MEGY, SOHA NEM ARRA, HOGY VAN-E KLIENS
      OLDALON OLVASHATO TOKEN. Termelesben a munkamenet httpOnly SUTIN all (a
      `ProductionAuthAdapter` a `session.token` mezot nem tolti ki), tehat egy
      `!token` kapu VEGLEGESEN kizarja ezt a hivast -- eles kornyezetben SOHA
      nem fut le, fejlesztoiben mindig. A ket kornyezet igy mast csinal, es a
      kulonbseg nema: hibauzenet nincs, a lista egyszeruen ures marad.

      A `token` (akar ures) VALTOZATLANUL megy at az apiRequest-nek: OTT dol
      el, hogy Bearer fejlec megy-e vagy a suti.

      Merve 2026-09-18: Balazs azt jelentette, hogy a mentett bejegyzes
      frissites utan eltunik. Az iras azert mukodott, mert azt gombnyomas
      hivja, kapu nelkul. Ugyanez a szabaly mar le volt irva a repoban
      (`product-list-page.tsx`), csak ide nem jutott el.
    */
    if (!canView) return;
    try {
      const response = await worksheetsApi.entries(token, worksheetId);
      setEntries(response.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A napló nem tölthető be.",
      );
    }
  }, [canView, token, worksheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    /**
     * A LEVAGOTT HOSSZ SZAMIT. A csupa szokozbol allo bejegyzes pontosan
     * annyit mond, mint a hianyzo -- viszont sort foglalna a listan, szerzot
     * es idopontot kapna, es ugy nezne ki, mintha valaki dolgozott volna. A
     * szerver ugyanigy szur; ha itt atengednenk, a felhasznalo egy technikai
     * hibauzenetet latna a sajat ures mezoje helyett.
     */
    const body = (draft ?? "").trim();
    if (!body) {
      setError("Írd le, mit csináltál.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await worksheetsApi.addEntry(token, worksheetId, body);
      setEntries(response.items);
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A bejegyzés nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
    AZ ÜRES, NEM SZERKESZTHETŐ KÁRTYA EGY SOR (kártya 7f23785c környéke, picasso R6, acrobot 62415): egy lezárt lapon a nulla elemű Bejegyzések és
    Anyagigények doboza együtt 400 px volt, és semmit nem mondott. Ahol nincs mit tenni vele (nincs írási jog, nincs bejegyzés, nincs hiba), a
    kártya helyett egy sor áll: kimondja, hogy nincs, és nem foglal helyet. Szerkeszthető lapon a kártya marad (ott a Bejegyzés gomb van benne).
  */
  if (entries && entries.length === 0 && !canWrite && !error)
    return (
      <p
        className="px-1 text-sm text-pilot-grey-500"
        data-testid="entries-empty-line"
      >
        Bejegyzések (0): ezen a lapon még nincs bejegyzés.
      </p>
    );

  return (
    <PilotCard>
      <PilotCardHeader
        title={`Bejegyzések${entries ? ` (${entries.length})` : ""}`}
      />
      <div className="space-y-3 p-4">
        {error ? <Alert variant="danger" title={error} /> : null}

        {canWrite ? (
          draft === null ? (
            <PilotButton variant="secondary" onClick={() => setDraft("")}>
              Bejegyzés
            </PilotButton>
          ) : (
            <div className="space-y-2">
              <Textarea
                aria-label="Mit csináltál"
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Például: szivattyú csere, a régi ment a szervizbe"
              />
              <PilotButton disabled={busy} onClick={() => void save()}>
                {busy ? "Mentés…" : "Rögzítés"}
              </PilotButton>
            </div>
          )
        ) : null}

        {entries === null ? <Skeleton className="h-16" /> : null}

        {entries && entries.length === 0 ? (
          <p className="text-sm text-pilot-grey-500">
            Ezen a lapon még nincs bejegyzés: a Bejegyzés gombbal írhatod le, mi
            történt.
          </p>
        ) : null}

        <ul className="space-y-2">
          {entries?.map((entry) => (
            <li key={entry.id} className="rounded border p-3">
              <p className="text-xs text-dusk-500">
                {worksheetEntryByline(entry)}
              </p>
              {/*
              A SOR EGY RESZLETET MUTAT, es a teljes szoveg a kulon lapon all --
              egy hosszu bejegyzes kulonben elnyomna a lap tobbi reszet.
            */}
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-dusk-800">
                {entry.body}
              </p>
              <Link
                className="text-xs font-semibold text-pilot-aqua-700 underline"
                href={`/szerviz/munkalapok/${worksheetId}/bejegyzesek/${entry.id}`}
              >
                Megnyitom
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PilotCard>
  );
}
