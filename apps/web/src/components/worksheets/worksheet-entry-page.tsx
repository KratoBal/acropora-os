"use client";

import {
  Alert,
  Button,
  Card,
  PageHeader,
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
 * EGY BEJEGYZES SAJAT LAPON.
 *
 * Balazs kerese, 2026-09-03: "ha rakattint egyre akkor nyiljon meg kulon lapon
 * (...) Felul vissza gomb a munkalapra."
 *
 * === A LISTAT KERI LE, NEM EGY SORT ===
 *
 * Nincs egy-bejegyzes vegpont, es szandekosan nincs: a lista mindent tartalmaz,
 * amit ez a lap mutat, es egy kulon vegpontot ezen kivul senki nem hivna. Igy a
 * lap HIDEG INDITASBOL is felall (kozvetlen linkbol), nem csak a listarol
 * erkezve.
 *
 * === A SZERKESZTES JOGA A SZERVERTOL JON ===
 *
 * A `canEdit` es az `editRefusal` a valaszban all; a felulet nem szamolja ujra.
 * A ket kulon elutasito mondat (van kit megkerni kontra senki nem szerkesztheti)
 * szinten a szerveren szuletik, hogy a ket kliens ugyanazt mondja.
 */
export function WorksheetEntryPage({
  worksheetId,
  entryId,
}: {
  worksheetId: string;
  entryId: string;
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
        cause instanceof Error ? cause.message : "A bejegyzés nem tölthető be.",
      );
    }
  }, [token, worksheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const entry = entries?.find((item) => item.id === entryId) ?? null;

  const save = async () => {
    const body = (draft ?? "").trim();
    if (!body) {
      setError("A bejegyzés nem lehet üres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await worksheetsApi.updateEntry(
        token,
        worksheetId,
        entryId,
        body,
      );
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
    <div className="space-y-4">
      {/*
        A VISSZA GOMB FELUL, es Balazs kifejezetten ezt kerte. A bongeszo sajat
        visszalepese nem helyettesiti: aki kozvetlen linkbol erkezik, annak
        nincs hova visszalepnie.
      */}
      <Link
        className="text-sm font-semibold text-teal-700 underline"
        href={`/szerviz/munkalapok/${worksheetId}`}
      >
        ← Vissza a munkalapra
      </Link>
      <PageHeader title="Bejegyzés" />

      {error ? <Alert variant="danger" title={error} /> : null}
      {entries === null ? <Skeleton className="h-24" /> : null}

      {/*
        A HIANYZO BEJEGYZES KIMONDVA. Ha a lista betoltodott es a sor nincs
        benne, az ures lap ugy nezne ki, mintha nem tortent volna semmi --
        pedig vagy megszunt, vagy rossz azonositoval nyilt meg.
      */}
      {entries !== null && !entry ? (
        <Alert
          variant="info"
          title="Ezt a bejegyzést nem találjuk ezen a munkalapon"
          description="Lehet, hogy időközben megszűnt."
        />
      ) : null}

      {entry ? (
        <Card className="space-y-3 p-4">
          <p className="text-xs text-slate-500">
            {worksheetEntryByline(entry)}
          </p>
          {draft === null ? (
            <p className="whitespace-pre-wrap text-sm text-slate-800">
              {entry.body}
            </p>
          ) : (
            <Textarea
              aria-label="A bejegyzés szövege"
              rows={8}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}

          {entry.canEdit ? (
            draft === null ? (
              <Button variant="secondary" onClick={() => setDraft(entry.body)}>
                Szerkesztem
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void save()}>
                {busy ? "Mentés…" : "Rögzítés"}
              </Button>
            )
          ) : (
            /*
              A HIANYZO GOMB MELLETT OTT AZ INDOKLAS, es ket kulon eset van: van
              kit megkerni, vagy senki nem szerkesztheti. Magyarazat nelkul a
              hianyzo gomb ugy nez ki, mint hiba a programban.
            */
            <p className="text-xs text-slate-500">{entry.editRefusal}</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
