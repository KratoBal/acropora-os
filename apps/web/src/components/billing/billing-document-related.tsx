"use client";

import { PilotBadge, PilotSection } from "@acropora/ui";
import type { BillingRelatedDocument } from "@acropora/types";
import Link from "next/link";

import { BillingDocumentStatus } from "./billing-document-status";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney } from "./billing-editor-state";

/** A lánc tagjainak neve; a sztornó és a helyesbítő nem kiállítható típus, de a lánc tagja. */
const TYPE_LABELS: Record<BillingRelatedDocument["documentType"], string> = {
  PROFORMA: "Díjbekérő",
  ADVANCE_INVOICE: "Előlegszámla",
  FINAL_INVOICE: "Végszámla",
  INVOICE: "Számla",
  STORNO: "Sztornó",
  CORRECTION: "Helyesbítő",
  DELIVERY_NOTE: "Szállítólevél",
};

/**
 * A KIMENŐ BIZONYLATOK LÁNCA a számla oldalán (task kimeno-kapcsolodo-bizonylatok;
 * Balázs 2026-10-23 13:08): a díjbekérő, az előleg, a végszámla és a sztornó
 * egymáshoz kötve, ugyanaz a lista a lánc minden tagján. A szerver üres listát
 * ad, ha a bizonylatnak nincs kapcsolódója, és akkor a szakasz nem jelenik meg.
 */
export function BillingDocumentRelated({
  documents,
}: {
  documents: BillingRelatedDocument[];
}) {
  if (documents.length === 0) return null;
  const byId = new Map(documents.map((document) => [document.id, document]));
  return (
    <PilotSection
      title="Kapcsolódó bizonylatok"
      subtitle="A díjbekérő, az előleg, a végszámla és a sztornó egy láncban."
    >
      <ul
        aria-label="Kapcsolódó bizonylatok"
        className="divide-y divide-pilot-grey-100 text-sm"
      >
        {documents.map((document) => {
          const cancelled = document.cancelsId
            ? byId.get(document.cancelsId)
            : null;
          const label = `${TYPE_LABELS[document.documentType]} · ${
            document.number ?? "még nincs száma"
          }`;
          return (
            <li
              key={document.id}
              className={`flex items-start justify-between gap-4 py-3 ${
                document.cancelsId ? "pl-4" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-pilot-grey-900">
                  {document.current ? (
                    <>
                      {label}{" "}
                      <PilotBadge variant="teal">Ez a bizonylat</PilotBadge>
                    </>
                  ) : (
                    <Link
                      href={`${BILLING_LIST_PATH}/${document.id}`}
                      className="underline"
                    >
                      {label}
                    </Link>
                  )}
                </p>
                <p className="text-xs text-pilot-grey-500">
                  {[
                    document.issueDate
                      ? formatDay(document.issueDate)
                      : "nincs kiállítva",
                    document.grossAmount
                      ? `bruttó ${formatMoney(document.grossAmount, document.currency)}`
                      : null,
                    document.cancelsId
                      ? `sztornózza: ${cancelled?.number ?? "másik bizonylat"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <BillingDocumentStatus
                status={document.status}
                emailStatus={null}
              />
            </li>
          );
        })}
      </ul>
    </PilotSection>
  );
}
