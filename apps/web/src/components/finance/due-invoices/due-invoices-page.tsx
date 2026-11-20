"use client";

import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  type DueInvoiceItem,
  type DueInvoicesResponse,
} from "@acropora/types";
import {
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotPageHeader,
  type PilotTableColumn,
} from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { dueInvoicesApi } from "@/lib/api/due-invoices";
import { formatDayHu } from "@/lib/format/date";

/**
 * PÉNZÜGY > LEJÁRÓ SZÁMLÁK (Balázs, Acropora OS szál, 2026-11-20 14:50 UTC; acrobot 58227, 58229). Az átutalással fizetendő, még
 * ki nem fizetett bejövő számlák; a lejártak elöl és külön jelölve, utána a határidő szerint. A sorrendet és a szűrést a szerver adja.
 *
 * A HIÁNYZÓ ADAT NEM ESIK KI: a cella „nincs adat”-ot ír, és a sor jelöli, mi hiányzik (Balázs jóváhagyta).
 */

const NO_DATA = "nincs adat";

/** A „nincs adat” jelzés: szürke, hogy ne tűnjön adatnak. */
function NoData({ what }: { what: string }) {
  return (
    <span
      className="text-xs font-semibold text-pilot-amber-700"
      title={`${what}: a számla nem hozta, kézzel kell pótolni`}
    >
      {NO_DATA}
    </span>
  );
}

const columns: PilotTableColumn<DueInvoiceItem>[] = [
  {
    id: "supplier",
    header: "Cég",
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate font-semibold text-pilot-grey-900">
          {row.supplierName}
        </span>
        {row.missing.paymentMethod ? (
          <span className="block text-xs text-pilot-amber-700">
            fizetési mód: {NO_DATA}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "dueDate",
    header: "Fizetési határidő",
    width: "170px",
    nowrap: true,
    cell: (row) => (
      <span className="block">
        {row.dueDate ? (
          <span className="tabular-nums">{formatDayHu(row.dueDate)}</span>
        ) : (
          <NoData what="Fizetési határidő" />
        )}
        {row.overdue ? (
          <span className="mt-1 block">
            <PilotBadge variant="danger">
              Lejárt ({row.daysOverdue} napja)
            </PilotBadge>
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "bankAccount",
    header: "Bankszámlaszám",
    width: "230px",
    nowrap: true,
    cell: (row) =>
      row.supplierBankAccount ? (
        <span className="tabular-nums">{row.supplierBankAccount}</span>
      ) : (
        <NoData what="A cég bankszámlaszáma" />
      ),
  },
  {
    id: "amount",
    header: "Összeg (hátralék)",
    width: "150px",
    align: "right",
    nowrap: true,
    cell: (row) => (
      <span className="font-semibold tabular-nums text-pilot-grey-900">
        {formatMoney(row.outstanding, row.currency)}
      </span>
    ),
  },
  {
    id: "reference",
    header: "Közlemény",
    width: "200px",
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate">{row.reference}</span>
        {row.referenceIsDefault ? (
          <span className="block text-xs text-pilot-grey-500">
            a számla száma (alapértelmezés)
          </span>
        ) : null}
      </span>
    ),
  },
];

export function DueInvoicesPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const [data, setData] = useState<DueInvoicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setData(null);
      try {
        setData(await dueInvoicesApi.list(token, signal));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A lejáró számlák nem tölthetők be.",
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
          A Lejáró számlákhoz finance.view jog kell.
        </p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Lejáró számlák"
        description="Az átutalással fizetendő, még ki nem fizetett bejövő számlák, a fizetési határidő szerint: a lejártak elöl."
      />
      {data && data.items.length > 0 ? (
        <p className="text-sm text-pilot-grey-700" data-testid="due-summary">
          {data.summary.count} számla
          {data.summary.overdue > 0
            ? `, ebből ${data.summary.overdue} lejárt`
            : ""}
          {data.summary.withMissingData > 0
            ? `, ${data.summary.withMissingData} sorból hiányzik adat`
            : ""}
          . Hátralék:{" "}
          {data.summary.totals
            .map((total) => formatMoney(total.outstanding, total.currency))
            .join(" + ")}
          .
        </p>
      ) : null}
      <section className="overflow-hidden rounded-xl bg-white ring-1 ring-pilot-grey-200">
        {error ? (
          <div role="alert" className="space-y-3 px-5 py-6 text-sm">
            <p className="text-pilot-red-700">{error}</p>
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => void load()}
            >
              Újrapróbálás
            </PilotButton>
          </div>
        ) : data === null ? (
          <p role="status" className="px-5 py-10 text-sm text-pilot-grey-500">
            A lejáró számlák betöltése…
          </p>
        ) : data.items.length === 0 ? (
          <p className="px-5 py-10 text-sm text-pilot-grey-500">
            Nincs kifizetetlen, átutalással fizetendő bejövő számla.
          </p>
        ) : (
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            rowLabel={(row) => `${row.supplierName} ${row.documentNumber}`}
            minWidth={980}
          />
        )}
      </section>
    </PilotThemeRoot>
  );
}
