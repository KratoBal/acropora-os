"use client";

import type { WorksheetDeletePreview } from "@acropora/types";
import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import { useState } from "react";

import { worksheetsApi } from "@/lib/api/worksheets";

/** MIT TÖRÖL A GOMB, EGY MONDATBAN (a hibajegy-törlés 2. szelete). A nulla darab kimarad. */
export function worksheetDeleteSummary(
  preview: WorksheetDeletePreview,
): string {
  const parts = [
    preview.counts.documents > 0
      ? `${preview.counts.documents} csatolmány`
      : null,
    preview.counts.materialRequests > 0
      ? `${preview.counts.materialRequests} anyagigény`
      : null,
  ].filter((part): part is string => part !== null);
  const head = `A(z) ${preview.label} munkalap véglegesen törlődik`;
  return parts.length === 0
    ? `${head}.`
    : `${head}, vele együtt ${parts.join(" és ")}.`;
}

/**
 * AZ ÖNÁLLÓ MUNKALAP VÉGLEGES TÖRLÉSE, EGY GOMBBAL ÉS FIGYELMEZTETŐ ABLAKKAL (a hibajegy-törlés 2. szelete; acrobot 55770). Ugyanaz a rend, mint a jegynél
 * (`ServiceJobDelete`): az előnézet a tiltás mondatát vagy az ablak szövegét adja, a kérés CSAK a megerősítés után megy el, a szerver hibája (409) a gomb alatt marad.
 * A jogot és azt, hogy a lap önálló-e, a hívó dönti el; a szerver ugyanezt kéri.
 */
export function WorksheetDelete({
  token,
  worksheetId,
  onDeleted,
}: {
  token: string;
  worksheetId: string;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<WorksheetDeletePreview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const next = await worksheetsApi.deletePreview(token, worksheetId);
      setPreview(next);
      setOpen(next.deletable);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A törlés nem készíthető elő.",
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await worksheetsApi.deleteWorksheet(token, worksheetId);
      setOpen(false);
      onDeleted();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const refusal = preview && !preview.deletable ? preview.refusal : null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PilotButton
          variant="danger"
          size="regular"
          disabled={busy}
          onClick={() => void ask()}
        >
          Törlés
        </PilotButton>
      </div>
      {refusal ? (
        <Alert variant="danger" title="Nem törölhető" description={refusal} />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A törlés nem sikerült"
          description={error}
        />
      ) : null}
      <ConfirmDialog
        open={open && preview !== null}
        title="Biztos, hogy véglegesen törlöd?"
        consequence={
          preview
            ? [worksheetDeleteSummary(preview), ...preview.warnings].join(" ")
            : ""
        }
        recovery="Nem vonható vissza."
        confirmLabel="Végleges törlés"
        busy={busy}
        onConfirm={() => void deleteNow()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
