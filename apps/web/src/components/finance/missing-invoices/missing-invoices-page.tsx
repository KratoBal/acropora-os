"use client";

import {
  hasPermission,
  PERMISSIONS,
  type BankStatementImportResult,
} from "@acropora/types";
import { PilotButton } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MISSING_INVOICES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { missingInvoicesApi } from "@/lib/api/missing-invoices";

import { MissingInvoicesImportResult } from "./missing-invoices-import-result";
import type { MonthRow } from "./missing-invoices-model";
import { MissingInvoicesMonthList } from "./missing-invoices-month-list";
import {
  toMonthRow,
  type MissingInvoiceCompany,
} from "./missing-invoices-wire";

/**
 * PÉNZÜGY > HIÁNYZÓ SZÁMLÁK: a hónapok (Figma 343:3, 343:651). Az adat a
 * szerveré (`GET /missing-invoices/months`, a céggel együtt); a sor a hónapot
 * nyitja.
 */
export function MissingInvoicesPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const [months, setMonths] = useState<MonthRow[] | null>(null);
  const [company, setCompany] = useState<MissingInvoiceCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const statementInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<BankStatementImportResult | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setMonths(null);
      try {
        const response = await missingInvoicesApi.months(token, signal);
        setCompany(response.company);
        setMonths(response.months.map(toMonthRow));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A hónapok nem tölthetők be.",
        );
      }
    },
    [token],
  );

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canView, load]);

  /**
   * AZ ELSŐ KIVONAT IS INNEN TÖLTHETŐ FEL: kivonat nélkül nincs hónap, amit
   * megnyithatna, tehát a havi oldal gombja egy üres rendszerben elérhetetlen.
   */
  const uploadStatement = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      setImported(await missingInvoicesApi.uploadStatement(token, file));
      await load();
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "A kivonat feltöltése nem sikerült.",
      );
    } finally {
      setUploading(false);
    }
  };

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <p className="text-sm text-pilot-grey-600">
          A Hiányzó számlákhoz finance.view jog kell.
        </p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <MissingInvoicesMonthList
        months={months}
        error={error}
        onRetry={() => void load()}
        onOpen={(month) => router.push(`${MISSING_INVOICES_PATH}/${month}`)}
        company={company}
        actions={
          <>
            {/* a Jev javaslatai a begyűjtésből (levél-válogatás, 4. szelet) */}
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() => router.push(`${MISSING_INVOICES_PATH}/javaslatok`)}
            >
              Javasolt számlák
            </PilotButton>
            {canManage ? (
              <PilotButton
                variant="secondary"
                size="regular"
                disabled={uploading}
                onClick={() => statementInput.current?.click()}
              >
                {uploading ? "Feltöltés…" : "Kivonat feltöltése"}
              </PilotButton>
            ) : null}
          </>
        }
        notice={
          <>
            {uploadError ? (
              <p role="alert" className="text-sm text-pilot-red-700">
                {uploadError}
              </p>
            ) : null}
            {imported ? (
              <MissingInvoicesImportResult
                result={imported}
                onClose={() => setImported(null)}
              />
            ) : null}
          </>
        }
      />
      <input
        ref={statementInput}
        type="file"
        accept=".csv,text/csv"
        aria-label="Bankkivonat CSV"
        className="sr-only"
        onChange={(event) => {
          void uploadStatement(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </PilotThemeRoot>
  );
}
