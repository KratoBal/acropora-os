"use client";

import type { BankStatementImportResult } from "@acropora/types";
import { PilotButton } from "@acropora/ui";
import Link from "next/link";

import { MISSING_INVOICES_PATH } from "@/components/navigation";

import { formatMonth } from "./missing-invoices-model";

/**
 * A KIVONAT-FELTÖLTÉS EREDMÉNYE (acrobot 25333): mi lett új, mi volt már meg,
 * és mit utasított el a szerver, SORONKÉNT, OKKAL. A lényeg, hogy egy
 * elutasított sor ne tűnjön el csendben: a feltöltés utáni újratöltés csak a
 * sikeres sorokat mutatná, a hibásakról semmit.
 *
 * A SZERVER AZ ELSŐ TÍZ ELUTASÍTOTT SORT ADJA, a számukat külön
 * (`rejectedCount`); ha több van, a panel kimondja, hány nem látszik.
 */
export function MissingInvoicesImportResult({
  result,
  onClose,
}: {
  result: BankStatementImportResult;
  onClose: () => void;
}) {
  const hidden = result.rejectedCount - result.rejected.length;
  const failed = result.rejectedCount > 0;
  return (
    <section
      aria-label="A kivonat-feltöltés eredménye"
      className={`space-y-3 rounded-xl px-5 py-4 text-sm ring-1 ${
        failed
          ? "bg-pilot-amber-50 ring-pilot-amber-100"
          : "bg-pilot-green-50 ring-pilot-grey-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-pilot-grey-900">
            {failed
              ? "A kivonat feltöltve, de nem minden sora olvasható"
              : "A kivonat feltöltve"}
          </h2>
          <p className="mt-1 break-words text-pilot-grey-700">
            {result.fileName}: {result.rowCount} sor olvasva,{" "}
            {result.createdCount} új, {result.skippedCount} már megvolt
            {failed ? `, ${result.rejectedCount} elutasítva` : ""}.
          </p>
        </div>
        <PilotButton variant="secondary" size="action" onClick={onClose}>
          Bezárás
        </PilotButton>
      </div>

      {failed ? (
        <div>
          <h3 className="font-semibold text-pilot-amber-700">
            Elutasított sorok
          </h3>
          <ul className="mt-1 space-y-1">
            {result.rejected.map((row) => (
              <li key={row.line} className="text-pilot-grey-800">
                <span className="font-medium tabular-nums">
                  {row.line}. sor:
                </span>{" "}
                {row.reason}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="mt-1 text-pilot-grey-700">
              És további {hidden} elutasított sor, ami itt nem látszik.
            </p>
          ) : null}
        </div>
      ) : null}

      {result.months.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-pilot-grey-600">Érintett hónapok:</span>
          {result.months.map((month) => (
            <Link
              key={month}
              href={`${MISSING_INVOICES_PATH}/${month}`}
              className="font-medium text-pilot-aqua-700 hover:underline"
            >
              {formatMonth(month)}
            </Link>
          ))}
        </div>
      ) : null}

      {result.accounts.length > 0 ? (
        <p className="text-xs text-pilot-grey-600">
          Bankszámlák a fájlban:{" "}
          {result.accounts
            .map((account) => `${account.accountNumber} (${account.currency})`)
            .join(", ")}
        </p>
      ) : null}
    </section>
  );
}
