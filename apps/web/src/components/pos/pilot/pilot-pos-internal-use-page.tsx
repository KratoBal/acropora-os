"use client";

import {
  PilotBackLink,
  backLinkLabel,
} from "@/components/pilot/pilot-back-link";
import { budapestDayOf, formatDayHu } from "@/lib/format/date";
import {
  Alert,
  PageHeader,
  Skeleton,
  PilotDateField,
  PAGE_GUTTER_MX,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  type PosInternalUseSummaryResponse,
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

/*
  A BELSŐ FELHASZNÁLÁS HAVI NÉZETE (kártya ada14a7c, az ec51e614 folytatása; acrobot 58517): a hónap végén egy lapon, mennyi
  áru ment el saját célra beszerzési értéken, és külön, melyik tételnek nincs beszerzési ára (ezeknek kell árat pótolni). Nem
  eladás, ezért nem az Eladások összesítőjén áll: ott a bevétel látszik, itt a beszerzési érték.
*/

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

/** The first and last day of the month `delta` months from the month of `day`. */
export function monthRange(
  day: string,
  delta: number,
): { from: string; to: string } {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + delta;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

type Preset = "month" | "previous";

const cell = "px-3 py-3";

export function PilotPosInternalUsePage() {
  const { session } = useAuth();
  const backTo = useReturnTo("/pos");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );

  // this month so far: the month's later days have nothing yet
  const [from, setFrom] = useState(() => monthRange(today(), 0).from);
  const [to, setTo] = useState(() => today());
  const [data, setData] = useState<PosInternalUseSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const thisMonth = { from: monthRange(today(), 0).from, to: today() };
  const previous = monthRange(today(), -1);
  const preset: Preset | null =
    from === thisMonth.from && to === thisMonth.to
      ? "month"
      : from === previous.from && to === previous.to
        ? "previous"
        : null;

  const choose = (next: Preset) => {
    const range = next === "month" ? thisMonth : previous;
    setFrom(range.from);
    setTo(range.to);
  };

  useEffect(() => {
    if (!canView || !from || !to) return;
    // A later request must not be overwritten by a slower earlier one.
    let current = true;
    setLoading(true);
    setError(null);
    void posApi
      .internalUseSummary(token, { from, to })
      .then((response) => {
        if (current) setData(response);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setData(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "A belső felhasználás betöltése nem sikerült.",
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
    "flex min-h-screen flex-col bg-pilot-grey-50 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]";

  if (!canView) {
    return (
      <PilotThemeRoot bleed className={shell}>
        <div className="p-8">
          <Alert
            variant="danger"
            title="Nincs hozzáférésed a belső felhasználáshoz"
            description="A megnyitáshoz orders.view jogosultság szükséges."
          />
        </div>
      </PilotThemeRoot>
    );
  }

  return (
    <PilotThemeRoot bleed className={shell}>
      <div className={`${PAGE_GUTTER_X} pb-5 pt-6`}>
        <PilotBackLink href={backTo.href}>
          {backLinkLabel(backTo, "Pénztár")}
        </PilotBackLink>
        <PageHeader
          title="Belső felhasználás"
          description="A polcról saját célra levett termékek, beszerzési értéken (nettó, a rögzítéskor). Nem eladás: a bevételben nem szerepel."
        />
      </div>

      <div className={`${PAGE_GUTTER_MX} mb-5 flex flex-wrap items-end gap-3`}>
        <div className="flex gap-2 text-xs font-semibold">
          <PilotButton
            variant={preset === "month" ? "primary" : "secondary"}
            size="regular"
            onClick={() => choose("month")}
          >
            Ez a hónap
          </PilotButton>
          <PilotButton
            variant={preset === "previous" ? "primary" : "secondary"}
            size="regular"
            onClick={() => choose("previous")}
          >
            Előző hónap
          </PilotButton>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-pilot-grey-500">
          Kezdő nap
          <PilotDateField
            value={from}
            max={to}
            onChange={(nextValue) => setFrom(nextValue)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium text-pilot-grey-500">
          Záró nap
          <PilotDateField
            value={to}
            min={from}
            onChange={(nextValue) => setTo(nextValue)}
          />
        </label>
      </div>

      {error ? (
        <div className={`${PAGE_GUTTER_MX} mb-8`}>
          <Alert variant="danger" title="Hiba történt" description={error} />
        </div>
      ) : loading && !data ? (
        <div className={`${PAGE_GUTTER_MX} mb-8`}>
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : data ? (
        <InternalUseSummary data={data} />
      ) : null}
    </PilotThemeRoot>
  );
}

function InternalUseSummary({ data }: { data: PosInternalUseSummaryResponse }) {
  return (
    <>
      <div className={`${PAGE_GUTTER_MX} mb-5`}>
        <PilotCard>
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-pilot-grey-500">
                Rögzítés
              </dt>
              <dd className="text-lg font-semibold tabular-nums text-pilot-grey-900">
                {data.recordCount}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-pilot-grey-500">
                Tétel
              </dt>
              <dd className="text-lg font-semibold tabular-nums text-pilot-grey-900">
                {data.lineCount}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-pilot-grey-500">
                {data.unpricedLineCount > 0
                  ? "Beszerzési érték (az ár nélküliek nélkül)"
                  : "Beszerzési érték"}
              </dt>
              <dd className="text-lg font-semibold tabular-nums text-pilot-grey-900">
                {formatMoney(data.knownCost, "HUF")}
              </dd>
            </div>
          </dl>
          {data.unpricedLineCount > 0 ? (
            <div className="px-5 pb-5">
              <Alert
                variant="info"
                className="!border-pilot-amber-100 !bg-pilot-amber-50 !text-pilot-amber-700"
                title={`${data.unpricedLineCount} tételnek nincs beszerzési ára`}
                description="Az érték ezek nélkül értendő. Lent külön listázva: ezeknek a termékeknek kell beszerzési árat pótolni."
              />
            </div>
          ) : null}
        </PilotCard>
      </div>

      {data.unpricedLines.length > 0 ? (
        <div className={`${PAGE_GUTTER_MX} mb-5`}>
          <PilotCard>
            <PilotCardHeader title="Beszerzési ár nélküli tételek" />
            <div className="overflow-x-auto px-4 pb-4">
              <table
                aria-label="Beszerzési ár nélküli tételek"
                className="w-full min-w-[560px] text-left text-xs"
              >
                <thead>
                  <tr className="border-b border-pilot-grey-100 text-[10px] uppercase tracking-wide text-pilot-grey-500">
                    <th className="py-3 pr-3 font-semibold">Nap</th>
                    <th className={`${cell} font-semibold`}>Szám</th>
                    <th className={`${cell} font-semibold`}>Cikkszám</th>
                    <th className={`${cell} font-semibold`}>Termék</th>
                    <th className="py-3 pl-3 text-right font-semibold">
                      Mennyiség
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.unpricedLines.map((line, index) => (
                    <tr
                      key={`${line.internalUseId}-${index}`}
                      className="border-b border-pilot-grey-100 last:border-0"
                    >
                      <td className="py-3 pr-3 tabular-nums">
                        {formatDayHu(budapestDayOf(line.occurredAt))}
                      </td>
                      <td className={cell}>{line.number}</td>
                      <td className={`${cell} font-semibold`}>{line.sku}</td>
                      <td className={cell}>{line.productName}</td>
                      <td className="py-3 pl-3 text-right tabular-nums">
                        {line.quantity} {line.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PilotCard>
        </div>
      ) : null}

      <div className={`${PAGE_GUTTER_MX} mb-8`}>
        <PilotCard>
          <PilotCardHeader title="Rögzítések" />
          {data.records.length === 0 ? (
            <p className="px-5 pb-5 text-xs text-pilot-grey-500">
              Ebben az időszakban nem volt belső felhasználás.
            </p>
          ) : (
            <div className="overflow-x-auto px-4 pb-4">
              <table
                aria-label="Rögzítések"
                className="w-full min-w-[640px] text-left text-xs"
              >
                <thead>
                  <tr className="border-b border-pilot-grey-100 text-[10px] uppercase tracking-wide text-pilot-grey-500">
                    <th className="py-3 pr-3 font-semibold">Nap</th>
                    <th className={`${cell} font-semibold`}>Szám</th>
                    <th className={`${cell} font-semibold`}>Megjegyzés</th>
                    <th className={`${cell} font-semibold`}>Rögzítette</th>
                    <th className={`${cell} text-right font-semibold`}>
                      Tétel
                    </th>
                    <th className="py-3 pl-3 text-right font-semibold">
                      Érték
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((record) => (
                    <tr
                      key={record.id}
                      className="border-b border-pilot-grey-100 last:border-0"
                    >
                      <td className="py-3 pr-3 tabular-nums">
                        {formatDayHu(budapestDayOf(record.occurredAt))}
                      </td>
                      <td className={cell}>{record.number}</td>
                      <td className={cell}>{record.note}</td>
                      <td className={cell}>{record.performedByName ?? "–"}</td>
                      <td className={`${cell} text-right tabular-nums`}>
                        {record.lineCount}
                      </td>
                      <td className="py-3 pl-3 text-right tabular-nums">
                        {record.totalCost !== null ? (
                          formatMoney(record.totalCost, "HUF")
                        ) : (
                          <span className="font-medium text-pilot-amber-700">
                            {record.unpricedLineCount} tétel ár nélkül
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PilotCard>
      </div>
    </>
  );
}
