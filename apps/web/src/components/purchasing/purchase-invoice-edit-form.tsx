"use client";

import { Alert, Button, Card, CardContent, CardHeader } from "@acropora/ui";
import type {
  PurchaseInvoiceDetail,
  UpdatePurchaseInvoiceInput,
} from "@acropora/types";
import { useState } from "react";

import { purchasingApi } from "@/lib/api/purchasing";

const FIELD =
  "mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500";

const dayOf = (value?: string) => (value ? value.slice(0, 10) : "");

/**
 * A RÖGZÍTETT SZÁMLA JAVÍTÁSA (Luca, 2026-10-08), csak ami nem hat a készletre:
 * számlaszám, dátumok, fizetés, megjegyzés és a sorok neve a számlán. A
 * mennyiség, az ár és a termék itt nem javítható: azokhoz a rögzítés
 * visszavonása kellene, ami külön döntés. Devizás számla kelte sem: az
 * árfolyam és a forintos költségek abból készültek.
 */
export function PurchaseInvoiceEditForm({
  token,
  detail,
  onSaved,
  onCancel,
}: {
  token: string;
  detail: PurchaseInvoiceDetail;
  onSaved: (detail: PurchaseInvoiceDetail) => void;
  onCancel: () => void;
}) {
  const foreign = detail.currency !== "HUF";
  const [number, setNumber] = useState(detail.supplierInvoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(dayOf(detail.invoiceDate));
  const [dueDate, setDueDate] = useState(dayOf(detail.dueDate));
  const [isPaid, setIsPaid] = useState(detail.isPaid);
  const [paidAt, setPaidAt] = useState(dayOf(detail.paidAt));
  const [note, setNote] = useState(detail.note ?? "");
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      detail.lines.map((l) => [l.id, l.sourceDescription ?? ""]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const input: UpdatePurchaseInvoiceInput = {
      supplierInvoiceNumber: number.trim(),
      ...(foreign ? {} : { invoiceDate }),
      dueDate: dueDate || null,
      isPaid,
      ...(isPaid ? { paidAt: paidAt || null } : {}),
      note: note.trim() || null,
      lines: detail.lines
        .filter((l) => (names[l.id] ?? "") !== (l.sourceDescription ?? ""))
        .map((l) => ({ id: l.id, sourceDescription: names[l.id] || null })),
    };
    try {
      onSaved(await purchasingApi.update(token, detail.id, input));
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A javítás nem menthető.",
      );
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-dusk-900">Adatok javítása</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-dusk-500">
          A rögzített számlán ezek javíthatók, mert nem hatnak a készletre. A
          mennyiség, az ár és a termék nem.
        </p>
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-dusk-500">
            Szállítói számlaszám
            <input
              className={FIELD}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <label className="text-xs text-dusk-500">
            Kelte
            <input
              type="date"
              className={FIELD}
              value={invoiceDate}
              disabled={foreign}
              title={
                foreign
                  ? "Devizás számla kelte nem módosítható: az árfolyam ebből készült."
                  : undefined
              }
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-dusk-500">
            Fizetési határidő
            <input
              type="date"
              className={FIELD}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-dusk-900">
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
              />
              Kifizetve
            </label>
            {isPaid ? (
              <label className="flex-1 text-xs text-dusk-500">
                Fizetés napja
                <input
                  type="date"
                  className={FIELD}
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </label>
            ) : null}
          </div>
          <label className="text-xs text-dusk-500 sm:col-span-2">
            Megjegyzés
            <input
              className={FIELD}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-dusk-500">
            A tételek neve a számlán
          </p>
          {detail.lines.map((line, index) => (
            <label key={line.id} className="block text-xs text-dusk-500">
              {index + 1}. {line.productName ?? "Kézi tétel"}
              <input
                className={FIELD}
                aria-label={`${index + 1}. tétel neve a számlán`}
                value={names[line.id] ?? ""}
                onChange={(e) =>
                  setNames({ ...names, [line.id]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Mégse
          </Button>
          <Button disabled={busy || !number.trim()} onClick={() => void save()}>
            Javítás mentése
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
