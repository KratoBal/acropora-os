"use client";

import type { DueInvoiceItem } from "@acropora/types";
import { PilotButton, PilotInput } from "@acropora/ui";
import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import { dueInvoicesApi } from "@/lib/api/due-invoices";

/**
 * A SZÁLLÍTÓI BANKSZÁMLASZÁM KÉZI MEGADÁSA A SORON (acrobot 58655, kártya 4900497b): a Pénzügy írási joga (`finance.manage`). A számlaszámot a felhasználó írja be, a szerver ellenőrzi (hazai
 * GIRO-szabály vagy IBAN). A SZÁMLA SAJÁT számlaszáma, a szállító másik számláján vagy a törzsben álló számlaszám nem írható át (a szerver elutasítja, a mondatát kiírjuk). A már kitöltött
 * számlaszám cseréje KÜLÖN, megerősített lépés: a szerver 409-cel válaszol, a felület megmutatja, mi áll ott, és a „Csere megerősítése” gombbal küldi újra.
 */
export function supplierAccountEditable(row: DueInvoiceItem): boolean {
  const source = row.supplierBankAccountSource;
  return (
    row.supplierBankAccount === null ||
    source === "INVOICE_PDF" ||
    source === "PAIRED_DEBIT" ||
    source === "MANUAL"
  );
}

export function SupplierAccountEditor({
  row,
  token,
  onSaved,
}: {
  row: DueInvoiceItem;
  token: string;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "confirm">("idle");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const label =
    row.supplierBankAccount === null ? "Számlaszám megadása" : "Csere";

  async function save(confirmReplace: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await dueInvoicesApi.setSupplierAccount(token, row.id, {
        account: value,
        ...(confirmReplace ? { confirmReplace: true } : {}),
      });
      setMode("idle");
      setValue("");
      onSaved();
    } catch (cause) {
      const text =
        cause instanceof Error ? cause.message : "A számlaszám nem menthető.";
      setMessage(text);
      setMode(
        cause instanceof ApiError && cause.status === 409 && !confirmReplace
          ? "confirm"
          : "edit",
      );
    } finally {
      setBusy(false);
    }
  }

  if (mode === "idle")
    return (
      <button
        type="button"
        className="mt-1 block text-xs font-semibold text-pilot-green-700 underline"
        onClick={() => setMode("edit")}
      >
        {label}
      </button>
    );
  return (
    <span className="mt-2 block space-y-2 whitespace-normal">
      <PilotInput
        aria-label={`Bankszámlaszám: ${row.supplierName} ${row.documentNumber}`}
        value={value}
        placeholder="pl. 11773016-11111018"
        disabled={busy || mode === "confirm"}
        onChange={setValue}
      />
      {message ? (
        <span role="alert" className="block text-xs text-pilot-red-700">
          {message}
        </span>
      ) : null}
      <span className="flex gap-2">
        {mode === "confirm" ? (
          <PilotButton
            size="action"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Csere megerősítése
          </PilotButton>
        ) : (
          <PilotButton
            size="action"
            disabled={busy || value.trim() === ""}
            onClick={() => void save(false)}
          >
            Mentés
          </PilotButton>
        )}
        <PilotButton
          variant="secondary"
          size="action"
          disabled={busy}
          onClick={() => {
            setMode("idle");
            setMessage(null);
            setValue("");
          }}
        >
          Mégse
        </PilotButton>
      </span>
    </span>
  );
}
