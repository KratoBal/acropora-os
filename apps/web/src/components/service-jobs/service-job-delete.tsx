"use client";

import type { ServiceJobDeletePreview } from "@acropora/types";
import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import { useState } from "react";

import { serviceJobsApi } from "@/lib/api/service-jobs";

/**
 * MIT TÖRÖL A GOMB, EGY MONDATBAN (Balázs, 2026-11-18). A darabszám nulla esetén kimarad; a karbantartási lap lapot mond, nem hibajegyet.
 */
export function deleteSummary(preview: ServiceJobDeletePreview): string {
  const thing =
    preview.kind === "MAINTENANCE" ? "karbantartási lap" : "hibajegy";
  const parts = [
    preview.counts.worksheets > 0
      ? `${preview.counts.worksheets} munkalap`
      : null,
    preview.counts.documents > 0
      ? `${preview.counts.documents} csatolmány`
      : null,
    preview.counts.materialRequests > 0
      ? `${preview.counts.materialRequests} anyagigény`
      : null,
  ].filter((part): part is string => part !== null);
  const head = `A(z) ${preview.jobNumber} ${thing} véglegesen törlődik`;
  if (parts.length === 0) return `${head}.`;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} és ${parts[parts.length - 1]}`;
  return `${head}, vele együtt ${list}.`;
}

/**
 * A HIBAJEGY (KARBANTARTÁSI LAP) VÉGLEGES TÖRLÉSE, EGY GOMBBAL ÉS FIGYELMEZTETŐ ABLAKKAL (Balázs, 2026-11-18; acrobot 55766, 55770). A gomb előnézetet kér (mit törölne,
 * szabad-e): tiltott jegynél a tiltás mondata áll ablak nélkül, törölhetőnél az ablak kimondja a számot, a darabszámokat és a figyelmeztetést. A kérés CSAK a megerősítés után
 * megy el; a szerver hibája (409) a gomb alatt marad. A jogot (`service.job.delete`) a hívó dönti el, hogy a gombot egyáltalán kirakja-e; a szerver ugyanezt kéri.
 */
export function ServiceJobDelete({
  token,
  jobId,
  onDeleted,
}: {
  token: string;
  jobId: string;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<ServiceJobDeletePreview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const next = await serviceJobsApi.deletePreview(token, jobId);
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
      await serviceJobsApi.deleteJob(token, jobId);
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
          preview ? [deleteSummary(preview), ...preview.warnings].join(" ") : ""
        }
        recovery={
          preview
            ? `Nem vonható vissza. A(z) ${preview.jobNumber} szám nem használódik újra.`
            : ""
        }
        confirmLabel="Végleges törlés"
        busy={busy}
        onConfirm={() => void deleteNow()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
