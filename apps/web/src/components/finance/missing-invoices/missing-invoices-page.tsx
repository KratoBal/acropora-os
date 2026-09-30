"use client";

import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MISSING_INVOICES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { missingInvoicesApi } from "@/lib/api/missing-invoices";

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
      />
    </PilotThemeRoot>
  );
}
