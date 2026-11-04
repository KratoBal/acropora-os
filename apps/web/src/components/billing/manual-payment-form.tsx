"use client";

import { Alert, PilotButton, PilotDateField, PilotInput } from "@acropora/ui";
import { useState } from "react";

import {
  billingDocumentsApi,
  type ManualOutgoingPaymentResult,
} from "@/lib/api/billing-documents";

/** A mai budapesti nap, `YYYY-MM-DD`. */
function budapestToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A KÉZI KIFIZETÉS ALAPÖSSZEGE gépi szövegként (a beviteli mezőbe, nem kiírásra): a bruttó
 * mínusz a kifizetett, forintnál egészre, más pénznemnél két tizedesre kerekítve.
 */
export function openAmountInput(
  grossAmount: string,
  paidAmount: string | null,
  currency: string,
): string {
  const scale = currency.toUpperCase() === "HUF" ? 1 : 100;
  const open =
    Math.abs(Number(grossAmount)) - Math.abs(Number(paidAmount ?? "0"));
  return String(Math.round(Math.max(open, 0) * scale) / scale);
}

/** a felületi korlát, egy mondatban (acrobot 42564) */
export const MANUAL_PAYMENT_UNDO_NOTE =
  "A kifizetés a Számlázz.hu-ba kerül. Egy hibásan rögzített kifizetést a Számlázz.hu felületén lehet törölni, innen nem.";

/**
 * KÉZI KIFIZETÉS-RÖGZÍTÉS EGY KIMENŐ SZÁMLÁRA (kártya 2026/00083-86; Balázs, 2026-11-04
 * 16:40 UTC). A szerver a Számlázz.hu-ba írja (`applyPaidMarks`, `MANUAL` forrás), és csak
 * nyitott vagy részben fizetett számlára, legfeljebb a nyitott összegig; itt csak a kérés
 * áll össze. Egy űrlap-megnyitás egy kérés-azonosító: a dupla kattintás nem két kifizetés.
 */
export function ManualPaymentForm({
  token,
  invoiceNumber,
  defaultAmount,
  onRecorded,
  onAttempted,
}: {
  token: string;
  invoiceNumber: string;
  /** a nyitott összeg (vagy a bruttó), egész forintra írva */
  defaultAmount: string;
  onRecorded?: (result: ManualOutgoingPaymentResult) => void;
  /** minden kísérlet után (sikeres vagy nem): a függő jelölések listája újraolvas */
  onAttempted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [date, setDate] = useState(budapestToday());
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const start = () => {
    setRequestId(crypto.randomUUID());
    setDate(budapestToday());
    setAmount(defaultAmount);
    setNote("");
    setError(null);
    setDone(null);
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await billingDocumentsApi.recordOutgoingPayment(token, {
        invoiceNumber,
        date,
        amount: amount.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        requestId,
      });
      setDone(result.message);
      setOpen(false);
      onRecorded?.(result);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A kifizetés rögzítése nem sikerült.",
      );
    } finally {
      setBusy(false);
      onAttempted?.();
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-pilot-grey-100 pt-3">
      {done ? <Alert variant="info" title={done} /> : null}
      {!open ? (
        <PilotButton variant="secondary" size="action" onClick={start}>
          Kifizetés rögzítése
        </PilotButton>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PilotDateField
              aria-label="A kifizetés dátuma"
              value={date}
              onChange={setDate}
              max={budapestToday()}
            />
            <PilotInput
              aria-label="Összeg"
              value={amount}
              onChange={setAmount}
              inputMode="decimal"
            />
          </div>
          <PilotInput
            aria-label="Megjegyzés"
            placeholder="Megjegyzés (pl. a banki közlemény)"
            value={note}
            onChange={setNote}
          />
          <p className="text-xs text-pilot-grey-500">
            {MANUAL_PAYMENT_UNDO_NOTE}
          </p>
          {error ? (
            <Alert
              variant="danger"
              title="Nem rögzítettem"
              description={error}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <PilotButton
              size="action"
              disabled={busy || !amount.trim() || !date}
              onClick={() => void submit()}
            >
              {busy ? "Rögzítés…" : "Rögzítés a Számlázz.hu-ban"}
            </PilotButton>
            <PilotButton
              variant="ghost"
              size="action"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Mégse
            </PilotButton>
          </div>
        </div>
      )}
    </div>
  );
}
