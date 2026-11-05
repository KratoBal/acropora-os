"use client";

import { Alert, ConfirmDialog } from "@acropora/ui";
import { useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import { paidMarksApi, type FeedPullLine } from "@/lib/api/paid-marks";

/** Egy figyelmet kérő sor, amit a Számlázz.hu-ból be lehet húzni: GLS NOT_FOUND, pontos számmal, a feedből hiányzik. */
export function canPullIntoFeed(item: {
  reference: string;
  reason: string;
  detail?: string;
}): boolean {
  return (
    item.reason === "NOT_FOUND" &&
    (item.detail ?? "").includes("nincs a Számlázz.hu feedben") &&
    /^(?:[A-Z]+-)?\d{4}\/\d+$/.test(item.reference)
  );
}

const OUTCOME_TEXT: Record<FeedPullLine["outcome"], string> = {
  WOULD_STORE: "behúzható",
  STORED: "behúzva",
  NOT_FOUND: "a Számlázz.hu-ban sincs ilyen szám",
  ERROR: "a lekérdezés nem sikerült",
  UNREADABLE: "a válasz nem olvasható",
  OTHER_NUMBER: "a válasz egy másik számla",
};

/**
 * „LEKÉRÉS A SZÁMLÁZZ.HU-BÓL” (aeddb2c3, acrobot 43506): a feedből hiányzó számla behúzása. Előbb száraz előnézet (a
 * Számlázz.hu-n csak olvas), a megerősítő ablak mutatja, mi kerülne be; a megerősítés húzza be. A következő napi
 * futás (vagy a „Futtatás most”) már párosítja.
 */
export function FeedPullButton({
  invoiceNumber,
  token,
}: {
  invoiceNumber: string;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FeedPullLine | null>(null);
  const [result, setResult] = useState<FeedPullLine | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const [line] = await paidMarksApi.feedPull(token, [invoiceNumber], apply);
      if (!line) throw new Error("A válasz üres.");
      if (apply) {
        setPreview(null);
        setResult(line);
      } else if (line.outcome === "WOULD_STORE") setPreview(line);
      else setResult(line);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Ismeretlen hiba");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      {result?.outcome === "STORED" ? null : (
        <PilotButton
          variant="secondary"
          disabled={busy}
          onClick={() => void ask(false)}
        >
          Lekérés a Számlázz.hu-ból
        </PilotButton>
      )}
      {result ? (
        <span data-testid="feed-pull-result">
          {invoiceNumber}: {OUTCOME_TEXT[result.outcome]}
          {result.outcome === "STORED"
            ? "; a következő futás már párosítja"
            : ` (${result.detail})`}
        </span>
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A lekérés nem sikerült"
          description={error}
        />
      ) : null}
      <ConfirmDialog
        open={preview !== null}
        title={`Behúzod a(z) ${invoiceNumber} számlát a Számlázz.hu-ból?`}
        consequence={`A számla a feed része lesz (${preview?.detail ?? ""}), és a következő kifizetett-jelölés már párosítja. A Számlázz.hu-ban nem változik semmi.`}
        recovery="Ugyanaz a számla másodszor nem kerül be; ha a Számlázz.hu később push-olja, az ugyanazt a sort frissíti."
        confirmLabel="Behúzás"
        busy={busy}
        onConfirm={() => void ask(true)}
        onCancel={() => setPreview(null)}
      />
    </span>
  );
}
