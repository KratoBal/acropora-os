"use client";

import { Alert, ConfirmDialog } from "@acropora/ui";
import { useEffect, useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import {
  paidMarksApi,
  type FeedPullLine,
  type PaidMarkAttentionItem,
  type PaidMarkSource,
} from "@/lib/api/paid-marks";

/**
 * Egy figyelmet kérő sor, amire a Számlázz.hu-t meg lehet kérdezni: GLS NOT_FOUND, pontos számmal, a feedből hiányzik.
 * Hogy a gomb ott legyen-e, azt NEM ez dönti el, hanem a Számlázz.hu válasza (`useFeedPreview`): a számlaszám előtagja
 * nem jel, mert a cmfx-ben kiállított ACRW számla egy része is a Számlázz.hu-ban van (6fd8c574, acrobot 43669).
 */
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

/** Egy kérés legfeljebb ennyi számot visz (a `FeedPullDto` határa). */
const PREVIEW_CHUNK = 10;

/**
 * A SZÁMLÁZZ.HU VÁLASZA A SOROKRA (6fd8c574): a lap betöltésekor a jelölt számokra száraz előnézet (a Számlázz.hu-n csak
 * olvasás, adatbázisba nem ír). `null`, amíg tart; egy szám hiányzik a térképből, ha a kérdés nem sikerült (akkor a
 * sor a régi, kattintásra kérdező gombot kapja).
 */
export function useFeedPreview(
  numbers: readonly string[],
  token: string,
  enabled: boolean,
): ReadonlyMap<string, FeedPullLine> | null {
  const [answers, setAnswers] = useState<ReadonlyMap<
    string,
    FeedPullLine
  > | null>(null);
  const wanted = enabled ? [...new Set(numbers)] : [];
  const signature = wanted.join("\n");
  useEffect(() => {
    if (!signature) {
      setAnswers(new Map());
      return;
    }
    let live = true;
    setAnswers(null);
    const all = signature.split("\n");
    void (async () => {
      const found = new Map<string, FeedPullLine>();
      for (let i = 0; i < all.length; i += PREVIEW_CHUNK) {
        try {
          const lines = await paidMarksApi.feedPull(
            token,
            all.slice(i, i + PREVIEW_CHUNK),
            false,
          );
          for (const line of lines) found.set(line.number, line);
        } catch {
          // a kérdés nem sikerült: ezek a számok a kattintásra kérdező gombot kapják
        }
      }
      if (live) setAnswers(found);
    })();
    return () => {
      live = false;
    };
  }, [signature, token]);
  return answers;
}

/**
 * „LEKÉRÉS A SZÁMLÁZZ.HU-BÓL” (aeddb2c3, acrobot 43506): a feedből hiányzó számla behúzása. Előbb száraz előnézet (a
 * Számlázz.hu-n csak olvas), a megerősítő ablak mutatja, mi kerülne be; a megerősítés húzza be. A következő napi
 * futás (vagy a „Futtatás most”) már párosítja.
 */
export function FeedPullButton({
  invoiceNumber,
  token,
  known,
}: {
  invoiceNumber: string;
  token: string;
  /** a betöltéskor kapott előnézet (WOULD_STORE): a gomb rögtön a megerősítést nyitja, nem kérdez újra */
  known?: FeedPullLine;
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
          onClick={() => (known ? setPreview(known) : void ask(false))}
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

/**
 * „KÉZZEL RENDEZVE” (6fd8c574; Balázs, 2026-11-05 16:07 UTC): a sor lezárása, mert a dolgot máshol, kézzel elintézték
 * (például a cmfx-ben jelölték kifizetettnek). Csak a mi listánkat zárja; a lezárt sor a „kézzel rendezve” részbe kerül,
 * onnan visszavonható.
 */
export function ManualCloseButton({
  source,
  item,
  token,
  onDone,
}: {
  source: PaidMarkSource;
  item: PaidMarkAttentionItem;
  token: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      await paidMarksApi.closeAttention(token, {
        source,
        key: item.key ?? item.reference,
        reason: item.reason,
        closed: true,
      });
      setConfirming(false);
      onDone();
    } catch (cause) {
      setConfirming(false);
      setError(cause instanceof Error ? cause.message : "Ismeretlen hiba");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <PilotButton
        variant="secondary"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        Kézzel rendezve
      </PilotButton>
      {error ? (
        <Alert
          variant="danger"
          title="A lezárás nem sikerült"
          description={error}
        />
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Kézzel rendezettnek jelölöd: ${item.reference}?`}
        consequence="A sor nem kér többé figyelmet, a „Kézzel rendezve” részben látszik, ki és mikor zárta le. A Számlázz.hu-ban és a cmfx-ben nem változik semmi."
        recovery="A „Kézzel rendezve” részből bármikor visszavonható, és a sor újra figyelmet kér."
        confirmLabel="Kézzel rendezve"
        busy={busy}
        onConfirm={() => void close()}
        onCancel={() => setConfirming(false)}
      />
    </span>
  );
}
