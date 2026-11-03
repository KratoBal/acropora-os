"use client";

import { PilotButton } from "@acropora/ui";
import { useState } from "react";

/**
 * „PAPÍRON MEGVAN” A KIMENŐ SZÁMLÁN (Balázs, Acropora OS szál, 2026-11-03 07:22 UTC): ugyanaz a gomb, mint a
 * bejövő számlán (#2006). A jelölt számla PDF-je nem kerül a havi kimenő csomagba, a borítón „papíron megvan”
 * áll. A gombot csak a `finance.manage` jog látja (mint a bejövőn); a pirula mindenkinek.
 *
 * Két darab, mert a közös fejlécben (`BillingDetailHeader`) két helyre kerülnek: a pirula az állapotok közé, a
 * gomb a műveletek közé.
 */
export function PaperOriginalPill({ marked }: { marked: boolean }) {
  if (!marked) return null;
  return (
    <span
      data-testid="paper-original-pill"
      title="A számla papíron megvan: a PDF-je nem kerül a havi kimenő csomagba."
      className="rounded-full bg-pilot-grey-100 px-2.5 py-1 text-xs font-semibold text-pilot-grey-700"
    >
      Papíron megvan
    </span>
  );
}

export function PaperOriginalButton<T>({
  marked,
  onToggle,
  onSaved,
}: {
  marked: boolean;
  /** A szerver hívása; a válasz a frissített adatlap. */
  onToggle: (marked: boolean) => Promise<T>;
  onSaved: (detail: T) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await onToggle(!marked));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A jelölés nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PilotButton
        size="regular"
        variant="secondary"
        disabled={busy}
        onClick={() => void toggle()}
      >
        {marked ? "Mégsem papíron" : "Papíron megvan"}
      </PilotButton>
      {error ? (
        <p role="alert" className="col-span-2 text-sm text-pilot-red-700">
          {error}
        </p>
      ) : null}
    </>
  );
}
