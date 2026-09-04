"use client";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import type { WorksheetEntryDetail } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";

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
  const [entries, setEntries] = useState<WorksheetEntryDetail[] | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await worksheetsApi.entries(token, worksheetId);
      setEntries(response.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A napló nem tölthető be.",
      );
    }
  }, [token, worksheetId]);

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

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Bejegyzések{entries ? ` (${entries.length})` : ""}
      </h2>

      {error ? <Alert variant="danger" title={error} /> : null}

      {canWrite ? (
        draft === null ? (
          <Button variant="secondary" onClick={() => setDraft("")}>
            Bejegyzés
          </Button>
        ) : (
          <div className="space-y-2">
            <Textarea
              aria-label="Mit csináltál"
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Például: szivattyú csere, a régi ment a szervizbe"
            />
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Mentés…" : "Rögzítés"}
            </Button>
          </div>
        )
      ) : null}

      {entries === null ? <Skeleton className="h-16" /> : null}

      {entries && entries.length === 0 ? (
        <EmptyState
          title="Ezen a lapon még nincs bejegyzés"
          description={
            canWrite
              ? "A Bejegyzés gombbal írhatod le, mi történt."
              : "A bejegyzéseket a lapon dolgozó kollégák írják."
          }
        />
      ) : null}

      <ul className="space-y-2">
        {entries?.map((entry) => (
          <li key={entry.id} className="rounded border p-3">
            <p className="text-xs text-slate-500">
              {worksheetEntryByline(entry)}
            </p>
            {/*
              A SOR EGY RESZLETET MUTAT, es a teljes szoveg a kulon lapon all --
              egy hosszu bejegyzes kulonben elnyomna a lap tobbi reszet.
            */}
            <p className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-800">
              {entry.body}
            </p>
            <Link
              className="text-xs font-semibold text-teal-700 underline"
              href={`/szerviz/munkalapok/${worksheetId}/bejegyzesek/${entry.id}`}
            >
              Megnyitom
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
