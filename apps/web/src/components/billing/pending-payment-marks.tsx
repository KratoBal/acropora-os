"use client";

import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import { formatMoney } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import {
  billingDocumentsApi,
  type PendingPaymentMark,
} from "@/lib/api/billing-documents";
import { formatDay } from "./billing-document-table";
import { OWN_MARK_SOURCE_LABELS } from "./billing-payment";

const sourceLabel = (source: string) =>
  OWN_MARK_SOURCE_LABELS[source as keyof typeof OWN_MARK_SOURCE_LABELS] ??
  source;

/**
 * A FÜGGŐ KIFIZETÉS-JELÖLÉSEK LEZÁRÁSA (barracuda, #2168 review). Egy megszakadt írás után ott maradt PLANNED
 * vagy UNKNOWN jelölés a számla kézi rögzítését „bizonytalan”-ra állítja. A kezelő a Számlázz.hu-n megnézi, és
 * itt lezárja: bekerült (a jelölés kifizetésnek számít), vagy nem került be (újra rögzíthető).
 */
export function PendingPaymentMarks({
  token,
  invoiceNumber,
  currency,
  refreshKey = 0,
  onResolved,
}: {
  token: string;
  invoiceNumber: string;
  currency: string;
  /** változásra újraolvas (pl. egy bizonytalan kézi rögzítés után) */
  refreshKey?: number;
  onResolved?: () => void;
}) {
  const [marks, setMarks] = useState<PendingPaymentMark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{
    mark: PendingPaymentMark;
    outcome: "WRITTEN" | "FAILED";
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMarks(
        await billingDocumentsApi.pendingPaymentMarks(token, invoiceNumber),
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A függő jelölések nem tölthetők be.",
      );
    }
  }, [invoiceNumber, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const resolve = async () => {
    if (!asking) return;
    setBusy(true);
    setError(null);
    try {
      await billingDocumentsApi.resolvePaymentMark(
        token,
        asking.mark.id,
        asking.outcome,
      );
      setAsking(null);
      await load();
      onResolved?.();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A jelölés lezárása nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (marks.length === 0 && !error) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-pilot-grey-100 pt-3">
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {marks.length > 0 ? (
        <>
          <p className="text-xs font-semibold text-pilot-grey-500">
            Bizonytalan kifizetés-írás: nézd meg a számlát a Számlázz.hu-n, és
            zárd le
          </p>
          <ul className="space-y-2 text-sm">
            {marks.map((mark) => (
              <li key={mark.id} className="space-y-1">
                <span className="text-pilot-grey-700">
                  {formatDay(mark.date)} · {sourceLabel(mark.source)} ·{" "}
                  {formatMoney(mark.amount, currency)}
                </span>
                <div className="flex flex-wrap gap-2">
                  <PilotButton
                    variant="secondary"
                    size="action"
                    onClick={() => setAsking({ mark, outcome: "WRITTEN" })}
                  >
                    Bekerült a Számlázz.hu-ba
                  </PilotButton>
                  <PilotButton
                    variant="secondary"
                    size="action"
                    onClick={() => setAsking({ mark, outcome: "FAILED" })}
                  >
                    Nem került be
                  </PilotButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        title={
          asking?.outcome === "WRITTEN"
            ? "A kifizetés bekerült a Számlázz.hu-ba?"
            : "A kifizetés NEM került be a Számlázz.hu-ba?"
        }
        consequence={
          asking?.outcome === "WRITTEN"
            ? "A jelölés kifizetésnek számít, a nyitott összeg ennyivel csökken."
            : "A jelölés lezárul, és a kifizetés újra rögzíthető."
        }
        recovery="Csak akkor zárd le, ha a számlát a Számlázz.hu felületén megnézted."
        confirmLabel="Lezárom"
        busy={busy}
        onConfirm={() => void resolve()}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
