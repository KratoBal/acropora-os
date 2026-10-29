"use client";

import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PosPaymentSummaryCell,
  type PosPaymentSummaryKey,
  type PosPaymentSummaryResponse,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { posApi } from "@/lib/api/pos";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/** Összesítő: napi bontás fizetési módonként (Kassza külön oszlopon). */

const METHOD_LABEL: Record<PosPaymentSummaryKey, string> = {
  CASH: "Pénztárgép",
  CARD: "Kártya",
  TRANSFER: "Utalás",
  CASH_DESK: "Kassza",
  UNKNOWN: "Nincs megadva",
};

const BUDAPEST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Budapest, `YYYY-MM-DD` (the server splits days the same way). */
function today(now = new Date()): string {
  return BUDAPEST_DAY.format(now);
}

function shiftDay(day: string, delta: number): string {
  const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function formatHuf(value: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft`;
}

function Cell({ cell }: { cell: PosPaymentSummaryCell | undefined }) {
  if (!cell || cell.count === 0) {
    return <span className="text-pilot-grey-400">–</span>;
  }
  return (
    <span className="block">
      <span className="block font-semibold tabular-nums text-pilot-grey-900">
        {formatHuf(cell.totalGross)}
      </span>
      <span className="block text-[10px] tabular-nums text-pilot-grey-500">
        {cell.count} db
      </span>
    </span>
  );
}

type Preset = "today" | "week";

export function PilotPosSummaryPage() {
  const { session } = useAuth();
  const backTo = useReturnTo("/pos");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );

  const [from, setFrom] = useState(() => today());
  const [to, setTo] = useState(() => today());
  const [data, setData] = useState<PosPaymentSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const preset: Preset | null =
    from === to && to === today()
      ? "today"
      : to === today() && from === shiftDay(to, -6)
        ? "week"
        : null;

  const choose = (next: Preset) => {
    const end = today();
    setTo(end);
    setFrom(next === "today" ? end : shiftDay(end, -6));
  };

  useEffect(() => {
    if (!canView || !from || !to) return;
    // A later request must not be overwritten by a slower earlier one.
    let current = true;
    setLoading(true);
    setError(null);
    void posApi
      .paymentSummary(token, { from, to })
      .then((response) => {
        if (current) setData(response);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setData(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Az összesítő betöltése nem sikerült.",
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [canView, from, to, token]);

  const shell =
    "-m-6 flex min-h-screen flex-col bg-pilot-grey-50 lg:-m-8 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]";

  if (!canView) {
    return (
      <PilotThemeRoot className={shell}>
        <div className="p-8">
          <Alert
            variant="danger"
            title="Nincs hozzáférésed az összesítőhöz"
            description="A megnyitáshoz orders.view jogosultság szükséges."
          />
        </div>
      </PilotThemeRoot>
    );
  }

  const dateInput =
    "h-9 rounded-lg bg-white px-2 text-xs text-pilot-grey-900 ring-1 ring-pilot-grey-200";

  return (
    <PilotThemeRoot className={shell}>
      <div className="px-8 pb-5 pt-6">
        <button
          type="button"
          onClick={backTo.goBack}
          className="mb-3 flex items-center gap-1.5 text-[11px] text-pilot-aqua-700 hover:underline"
        >
          <Icon name="chevron-left" size={12} />
          {backTo.fromWithinApp ? "Vissza" : "Vissza a pénztárhoz"}
        </button>
        <h1 className="text-[28px] font-semibold leading-tight text-pilot-grey-900">
          Eladások összesítője
        </h1>
        <p className="mt-1.5 text-xs text-pilot-grey-600">
          Napi bontás fizetési módonként. Csak a lezárt eladások számítanak, a
          bruttó végösszeggel.
        </p>
      </div>

      <div className="mx-8 mb-5 flex flex-wrap items-end gap-3">
        <div className="flex gap-2 text-xs font-semibold">
          <PilotButton
            variant={preset === "today" ? "primary" : "secondary"}
            size="regular"
            onClick={() => choose("today")}
          >
            Ma
          </PilotButton>
          <PilotButton
            variant={preset === "week" ? "primary" : "secondary"}
            size="regular"
            onClick={() => choose("week")}
          >
            Utolsó 7 nap
          </PilotButton>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-pilot-grey-500">
          Kezdő nap
          <input
            type="date"
            className={dateInput}
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-pilot-grey-500">
          Záró nap
          <input
            type="date"
            className={dateInput}
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>

      <div className="mx-8 mb-8">
        <PilotCard>
          <PilotCardHeader title="Fizetési módok" />
          {error ? (
            <div className="p-5">
              <Alert
                variant="danger"
                title="Hiba történt"
                description={error}
              />
            </div>
          ) : loading && !data ? (
            <div className="p-5">
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : data ? (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="border-b border-pilot-grey-100 text-[10px] uppercase tracking-wide text-pilot-grey-500">
                    <th className="py-3 pr-3 font-semibold">Nap</th>
                    {data.methods.map((method) => (
                      <th
                        key={method}
                        className="px-3 py-3 text-right font-semibold"
                      >
                        {METHOD_LABEL[method]}
                      </th>
                    ))}
                    <th className="py-3 pl-3 text-right font-semibold">
                      Összesen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.days].reverse().map((day) => (
                    <tr
                      key={day.date}
                      className="border-b border-pilot-grey-100 last:border-0"
                    >
                      <td className="py-3 pr-3 tabular-nums text-pilot-grey-900">
                        {day.date}
                      </td>
                      {data.methods.map((method) => (
                        <td key={method} className="px-3 py-3 text-right">
                          <Cell cell={day.byMethod[method]} />
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right">
                        <Cell cell={day.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-pilot-grey-200">
                    <th scope="row" className="py-3 pr-3 font-semibold">
                      Összesen
                    </th>
                    {data.methods.map((method) => (
                      <td key={method} className="px-3 py-3 text-right">
                        <Cell cell={data.totals.byMethod[method]} />
                      </td>
                    ))}
                    <td className="py-3 pl-3 text-right">
                      <Cell cell={data.totals.total} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </PilotCard>
      </div>
    </PilotThemeRoot>
  );
}
