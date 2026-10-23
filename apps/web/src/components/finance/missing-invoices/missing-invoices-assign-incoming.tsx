"use client";

import { Alert } from "@acropora/ui";
import type { IncomingDocumentListItem } from "@acropora/types";
import { useState } from "react";

import { PilotButton, PilotInput } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { formatAmount, formatDay } from "./missing-invoices-model";

/**
 * EGY NEM PÁROSODOTT FÁJL HOZZÁRENDELÉSE EGY BEJÖVŐ SZÁMLÁHOZ (acrobot
 * 35522/35529: egy lépésben kézzel hozzárendelhető). Keresés a szállító nevére
 * vagy adószámára; csak az a sor választható, aminek még NINCS PDF-je, és aminek
 * van feed-adatlapja (a `mailbox:` és `purchase:` előtagú sorokhoz a szerver
 * sem csatol). A hozzárendelés a fájlt a sor PDF-jévé teszi, nem másolja.
 */
export function AssignToIncomingPanel({
  token,
  documentId,
  onAssigned,
  onClose,
}: {
  token: string;
  documentId: string;
  onAssigned: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<IncomingDocumentListItem[] | null>(null);
  const [busy, setBusy] = useState<string | "search" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy("search");
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (query.trim()) params.set("q", query.trim());
      const response = await billingDocumentsApi.incomingList(token, params);
      setRows(
        response.items.filter((item) => !item.hasPdf && !item.id.includes(":")),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A keresés nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };

  const assign = async (rowId: string) => {
    setBusy(rowId);
    setError(null);
    try {
      await billingDocumentsApi.assignIncomingDocument(
        token,
        rowId,
        documentId,
      );
      onAssigned();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A hozzárendelés nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Hozzárendelés bejövő számlához"
      className="space-y-3 rounded-xl bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem] flex-1">
          <PilotInput
            aria-label="Szállító neve vagy adószáma"
            placeholder="Szállító neve vagy adószáma"
            value={query}
            onChange={setQuery}
          />
        </div>
        <PilotButton
          size="action"
          disabled={busy !== null}
          onClick={() => void search()}
        >
          {busy === "search" ? "Keresés…" : "Keresés"}
        </PilotButton>
        <PilotButton size="action" variant="secondary" onClick={onClose}>
          Bezár
        </PilotButton>
      </div>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {rows === null ? (
        <p className="text-sm text-pilot-grey-500">
          Keress a szállítóra, és válaszd ki a számlát, amelynek a PDF-je ez.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          Nincs ilyen számla PDF nélkül.
        </p>
      ) : (
        <ul
          aria-label="PDF nélküli bejövő számlák"
          className="divide-y divide-pilot-grey-200"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-pilot-grey-900">
                  {row.documentNumber}
                </span>
                <span className="truncate text-xs text-pilot-grey-500">
                  {[
                    row.supplierName,
                    formatDay(row.issueDate),
                    row.grossAmount
                      ? formatAmount(row.grossAmount, row.currency)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <PilotButton
                size="action"
                disabled={busy !== null}
                aria-label={`${row.documentNumber} számlához rendel`}
                onClick={() => void assign(row.id)}
              >
                {busy === row.id ? "Hozzárendelés…" : "Hozzárendel"}
              </PilotButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
