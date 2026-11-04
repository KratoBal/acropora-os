"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotCard,
  PilotButton,
} from "@acropora/ui";
import type {
  PartnerMergeLogEntry,
  PartnerMergePreview,
  PartnerMergeReferenceTable,
  PartnerMergeUndoResult,
  PartnerMigrationPlan,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { partnerMergeApi } from "@/lib/api/partner-merge";

/**
 * AZ ÁLLATKERT-SZERŰ PÁR: ugyanazon az adószámon további vevő-sorok vannak, mint a partner kötött sora (MERGE_CANDIDATES). Az
 * ÖSSZEVONÁS külön, kifejezett lépés: Előnézet (mi kerül át, mi akadály), Összevonás az előnézet lenyomatával, a napló sorain
 * Visszavonás. A megmaradó sor mindig a partner kötött sora (a munkalapok hozzá kötődnek).
 */
export const TABLE_LABEL: Record<PartnerMergeReferenceTable, string> = {
  SalesOrder: "rendelés",
  Aquarium: "akvárium",
  ServiceJob: "szerviz-munka",
  Invoice: "számla",
  Project: "projekt",
  Asset: "eszköz",
  WorksheetDepartment: "munkalap-osztály",
  Worksheet: "munkalap",
  Contract: "szerződés",
  Quote: "árajánlat",
  PartnerOrder: "partner-rendelés",
  ReefClubCustomerLink: "ReefClub-összekötés",
  ReefClubLinkCode: "ReefClub-kód",
  User: "felhasználó",
  CustomerAddress: "cím",
  CustomerAlias: "régi azonosító",
  ExternalReference: "UNAS-hivatkozás",
};

const describeCounts = (
  counts: Partial<Record<PartnerMergeReferenceTable, number>>,
): string => {
  const parts = Object.entries(counts).map(
    ([table, count]) =>
      `${count} ${TABLE_LABEL[table as PartnerMergeReferenceTable] ?? table}`,
  );
  return parts.length ? parts.join(", ") : "semmi";
};

const total = (
  counts: Partial<Record<PartnerMergeReferenceTable, number>>,
): number => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

const moment = (iso: string): string =>
  new Date(iso).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });

interface Pair {
  keptId: string;
  mergedId: string;
}
const keyOf = (pair: Pair) => `${pair.keptId}:${pair.mergedId}`;

export function PartnerMergeSection({
  token,
  plan,
  onChanged,
}: {
  token: string;
  plan: PartnerMigrationPlan;
  onChanged: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, PartnerMergePreview>>(
    {},
  );
  const [log, setLog] = useState<PartnerMergeLogEntry[] | null>(null);
  const [confirmMerge, setConfirmMerge] = useState<PartnerMergePreview | null>(
    null,
  );
  const [confirmUndo, setConfirmUndo] = useState<PartnerMergeLogEntry | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const names = new Map<string, string>();
  const pairs: Array<{
    partner: string;
    kept: string;
    merged: string;
    pair: Pair;
  }> = [];
  for (const row of plan.rows) {
    if (row.action !== "MERGE_CANDIDATES" || !row.linkedCustomer) continue;
    names.set(
      row.linkedCustomer.id,
      `${row.linkedCustomer.displayName} (${row.linkedCustomer.customerNumber})`,
    );
    for (const candidate of row.candidates) {
      names.set(
        candidate.id,
        `${candidate.displayName} (${candidate.customerNumber})`,
      );
      pairs.push({
        partner: row.name,
        kept: names.get(row.linkedCustomer.id)!,
        merged: names.get(candidate.id)!,
        pair: { keptId: row.linkedCustomer.id, mergedId: candidate.id },
      });
    }
  }
  const nameOf = (id: string) => names.get(id) ?? id;

  const loadLog = useCallback(async () => {
    try {
      setLog(await partnerMergeApi.list(token));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A napló nem tölthető be.",
      );
    }
  }, [token]);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setPreviews({});
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
      setConfirmMerge(null);
      setConfirmUndo(null);
    }
  };

  const runPreview = (pair: Pair) =>
    guard(async () => {
      const result = await partnerMergeApi.preview(
        token,
        pair.keptId,
        pair.mergedId,
      );
      setPreviews((current) => ({ ...current, [keyOf(pair)]: result }));
    });
  const runMerge = () =>
    guard(async () => {
      if (!confirmMerge) return;
      const entry = await partnerMergeApi.execute(token, {
        keptId: confirmMerge.keptId,
        mergedId: confirmMerge.mergedId,
        fingerprint: confirmMerge.fingerprint,
        reason: "partner-átvezetés oldal",
      });
      setPreviews({});
      setNotice(
        `Összevonva: ${describeCounts(entry.moved)} került át a megmaradó sorra.`,
      );
      await loadLog();
      onChanged();
    });
  const runUndo = () =>
    guard(async () => {
      if (!confirmUndo) return;
      const result: PartnerMergeUndoResult = await partnerMergeApi.undo(
        token,
        confirmUndo.id,
      );
      setPreviews({});
      setNotice(
        `Visszavonva: ${describeCounts(result.restored)} visszakerült${
          total(result.skipped)
            ? `; ${describeCounts(result.skipped)} közben máshová került, ezek maradtak`
            : ""
        }.${result.notes.length ? ` ${result.notes.join(" ")}` : ""}`,
      );
      await loadLog();
      onChanged();
    });

  if (!pairs.length && !(log && log.length)) return null;

  return (
    <PilotCard>
      <div className="space-y-4 px-5 py-4" data-testid="merge-section">
        <div>
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Vevő-sorok összevonása (állatkert-szerű párok)
          </h2>
          <p className="text-xs text-pilot-grey-600">
            A megmaradó sor a partner kötött sora; a másik sor hivatkozásai
            átkerülnek rá, és archiválódik. Előbb Előnézet, az Összevonás az
            előnézet lenyomatával fut.
          </p>
        </div>

        {error ? (
          <Alert
            variant="danger"
            title="A művelet nem futott le"
            description={error}
          />
        ) : null}
        {notice ? (
          <Alert variant="info" title="Kész" description={notice} />
        ) : null}

        {pairs.map(({ partner, kept, merged, pair }) => {
          const preview = previews[keyOf(pair)];
          return (
            <div
              key={keyOf(pair)}
              className="space-y-2 border-t border-pilot-grey-100 pt-3"
              data-testid="merge-pair"
            >
              <p className="text-sm text-pilot-grey-900">
                <span className="font-semibold">{partner}</span>: megmarad{" "}
                <span className="font-mono text-xs">{kept}</span>, megszűnik{" "}
                <span className="font-mono text-xs">{merged}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => runPreview(pair)}
                >
                  Előnézet
                </PilotButton>
                <PilotButton
                  disabled={busy || !preview || !preview.canExecute}
                  title={!preview ? "Előbb nézd meg az előnézetet" : undefined}
                  onClick={() => preview && setConfirmMerge(preview)}
                >
                  Összevonás
                </PilotButton>
              </div>
              {preview ? (
                <div
                  className="space-y-1 text-xs text-pilot-grey-700"
                  data-testid="merge-preview"
                >
                  <PilotBadge variant={preview.canExecute ? "teal" : "amber"}>
                    {preview.canExecute ? "Összevonható" : "Nem vonható össze"}
                  </PilotBadge>
                  <p>Átkerülne: {describeCounts(preview.willMove)}.</p>
                  {preview.fieldFills.length ? (
                    <p>
                      A megmaradó sor üres mezői kitöltődnek:{" "}
                      {preview.fieldFills.map((fill) => fill.field).join(", ")}.
                    </p>
                  ) : null}
                  {preview.blockers.map((blocker) => (
                    <p
                      key={blocker}
                      className="font-semibold text-pilot-grey-900"
                    >
                      Akadály: {blocker}
                    </p>
                  ))}
                  {preview.notes.map((note) => (
                    <p key={note}>Megjegyzés: {note}</p>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {log && log.length ? (
          <div
            className="space-y-1 border-t border-pilot-grey-100 pt-3"
            data-testid="merge-log"
          >
            <p className="text-xs font-semibold text-pilot-grey-800">Napló</p>
            <ul className="divide-y divide-pilot-grey-100 text-xs text-pilot-grey-700">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    {moment(entry.createdAt)}: {nameOf(entry.mergedId)} →{" "}
                    {nameOf(entry.keptId)}, {describeCounts(entry.moved)}
                    {entry.undoneAt
                      ? ` (visszavonva: ${moment(entry.undoneAt)})`
                      : ""}
                  </span>
                  {entry.undoneAt ? null : (
                    <PilotButton
                      variant="secondary"
                      size="regular"
                      disabled={busy}
                      onClick={() => setConfirmUndo(entry)}
                    >
                      Visszavonás
                    </PilotButton>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmMerge !== null}
        title="Összevonod ezt a két vevő-sort?"
        consequence={`A(z) ${confirmMerge?.target ?? ""} adatbázison a(z) ${confirmMerge ? nameOf(confirmMerge.mergedId) : ""} sor hivatkozásai (${confirmMerge ? describeCounts(confirmMerge.willMove) : ""}) a(z) ${confirmMerge ? nameOf(confirmMerge.keptId) : ""} sorra kerülnek, a megszűnő sor archiválódik. A kiállított számlák tartalma nem változik.`}
        recovery="A napló során a Visszavonás visszaviszi, ami még a megmaradó soron áll; ami közben máshová került, az marad."
        confirmLabel="Összevonás"
        busy={busy}
        onConfirm={() => void runMerge()}
        onCancel={() => setConfirmMerge(null)}
      />
      <ConfirmDialog
        open={confirmUndo !== null}
        title="Visszavonod ezt az összevonást?"
        consequence={`A(z) ${confirmUndo ? nameOf(confirmUndo.mergedId) : ""} sor újra aktív lesz, és visszakapja a hivatkozásait, amik még a megmaradó soron állnak (${confirmUndo ? describeCounts(confirmUndo.moved) : ""}). Ami az összevonás óta új rekordként érkezett, az a megmaradó soron marad.`}
        recovery="Az összevonás újra elvégezhető az Előnézet és az Összevonás gombbal."
        confirmLabel="Visszavonás"
        busy={busy}
        onConfirm={() => void runUndo()}
        onCancel={() => setConfirmUndo(null)}
      />
    </PilotCard>
  );
}
