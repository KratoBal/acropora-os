"use client";

import {
  Alert,
  PilotBadge,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import type { SupplierPriceRow, VariantSupplierPrices } from "@acropora/types";
import { useEffect, useState } from "react";

import { priceListsApi } from "@/lib/api/price-lists";

/**
 * A VÁLTOZAT BESZERZÉSI ÁRAI BESZÁLLÍTÓNKÉNT ÉS A HASZON (task beszallitoi-arlistak-4).
 *
 * A sorokat a szerver rendezi (a legolcsóbb forintos beszerzési ár elöl, a
 * forintra nem váltható sor a végén), és a hiányzó értéket nevesített okkal adja:
 * itt sem íródik ki nulla ott, ahol nincs adat.
 *
 * Az "automatikus" kötés látszik: a rendszer kötötte a vonalkód vagy az ismert
 * cikkszám alapján, ember még nem hagyta jóvá, tehát az ár hibás termékhez is
 * tartozhat.
 */

/**
 * A nettó eladási ár hiányának okai magyarul. A kódok a szerver `resolvePriceSource`
 * (`PriceSourceRefusal`) és `listPriceFromDecision` függvényéből jönnek; a teszt
 * minden ismert kódra megköveteli a magyar szöveget, ismeretlen kód nyersen jelenik meg.
 */
const SELLING_REASON_LABELS: Record<string, string> = {
  "authority-unknown": "nincs eldöntve, melyik rendszer a termék gazdája",
  "mirror-row-missing": "a UNAS-tükörben nincs a termékről sor",
  "mirror-price-missing": "a UNAS-tükörben nincs a termékhez ár",
  "own-price-missing": "a saját árunk nincs kitöltve",
  "price-missing": "nincs eladási ár a törzsben",
  "vat-rate-missing": "nincs áfakulcs a változaton",
};
export const KNOWN_SELLING_REASONS = Object.keys(SELLING_REASON_LABELS);

export function sellingReasonText(reason: string | null): string {
  if (!reason) return "ismeretlen ok";
  if (reason.startsWith("currency-"))
    return `az eladási ár pénzneme nem forint (${reason.slice("currency-".length)})`;
  return SELLING_REASON_LABELS[reason] ?? reason;
}

function number(amount: string): string {
  return Number(amount).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
}

function money(amount: string | null, currency: string): string {
  return amount === null ? "—" : `${number(amount)} ${currency}`;
}

function listDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${year}. ${month}. ${date}.` : day;
}

export type PriceRank = "cheapest" | "dearest" | null;

/**
 * AZ ÁRAK ÖSSZEVETÉSE SZÍNNEL ÉS SZÖVEGGEL (Balázs 2026-10-23 20:42 UTC): ha egy
 * termékhez több beszállítótól van ára, a legolcsóbb zöld, a legdrágább piros,
 * kettő felett a közbülső semleges; egyenlő árnál mindkettő zöld (és nincs
 * piros).
 *
 * AZONOS PÉNZNEMBEN a lista saját pénznemében írt egységárat vetjük össze. EGY
 * TERMÉK EGYIK ÁRA SEM VALUTÁBAN, A MÁSIK FORINTBAN (acrobot 35869, barracuda
 * 35866): ilyenkor a szerver által MNB-árfolyammal forintra számolt beszerzési
 * árat vetjük össze, és a kártya kimondja, hogy átszámolt (az árfolyam napjával).
 * Ha egy sorhoz nincs árfolyam, nem színezünk, és a kártya ezt is kimondja.
 */
export interface PriceComparison {
  ranks: PriceRank[];
  /** Eltérő pénznemek, forintra átszámolva vetettük össze (az árfolyamok napjai). */
  converted: { currencies: string[]; fxDates: string[] } | null;
  /** Eltérő pénznemek, de nem minden sorhoz van árfolyam: nincs összevetés. */
  missingRate: string[] | null;
}

export function rankPrices(rows: readonly SupplierPriceRow[]): PriceComparison {
  const none = rows.map((): PriceRank => null);
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const rank = (values: number[]): PriceRank[] => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values.map((value): PriceRank =>
      value === min ? "cheapest" : value === max ? "dearest" : null,
    );
  };
  if (currencies.length > 1) {
    if (rows.some((row) => row.purchaseHuf === null))
      return { ranks: none, converted: null, missingRate: currencies };
    return {
      ranks: rank(rows.map((row) => Number(row.purchaseHuf))),
      converted: {
        currencies,
        fxDates: [
          ...new Set(rows.flatMap((row) => (row.fxDate ? [row.fxDate] : []))),
        ].sort(),
      },
      missingRate: null,
    };
  }
  if (rows.length < 2)
    return { ranks: none, converted: null, missingRate: null };
  return {
    ranks: rank(rows.map((row) => Number(row.unitPrice))),
    converted: null,
    missingRate: null,
  };
}

const RANK_LABELS: Record<Exclude<PriceRank, null>, string> = {
  cheapest: "legolcsóbb",
  dearest: "legdrágább",
};

export function SupplierPricesTable({
  prices,
}: {
  prices: VariantSupplierPrices;
}) {
  const { ranks, converted, missingRate } = rankPrices(prices.rows);
  const rankOf = new Map(prices.rows.map((row, index) => [row, ranks[index]!]));
  const columns: PilotTableColumn<SupplierPriceRow>[] = [
    {
      id: "supplier",
      header: "Beszállító",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-pilot-grey-900">
            {row.supplierName}
          </span>
          <span className="truncate text-xs text-pilot-grey-500">
            {row.supplierSku}
            {row.listedName ? ` · ${row.listedName}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "unit",
      header: "Beszerzési ár",
      align: "right",
      cell: (row) => {
        const rank = rankOf.get(row) ?? null;
        return (
          <span className="flex flex-col items-end gap-1">
            <span
              data-rank={rank ?? "none"}
              className={
                rank === "cheapest"
                  ? "font-semibold text-pilot-green-700"
                  : rank === "dearest"
                    ? "font-semibold text-pilot-red-700"
                    : undefined
              }
            >
              {money(row.unitPrice, row.currency)}
            </span>
            {rank ? (
              <PilotBadge variant={rank === "cheapest" ? "success" : "danger"}>
                {RANK_LABELS[rank]}
                {converted ? " (forintra átszámolva)" : ""}
              </PilotBadge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "huf",
      header: "Forintban",
      align: "right",
      cell: (row) =>
        row.purchaseHuf === null ? (
          <span title="Nincs elérhető MNB-árfolyam ehhez a pénznemhez.">
            nincs árfolyam
          </span>
        ) : (
          <span className="flex flex-col items-end">
            <span>{money(row.purchaseHuf, "Ft")}</span>
            {row.fxRate && row.fxDate ? (
              <span className="text-xs text-pilot-grey-500">
                {number(row.fxRate)} Ft/{row.currency}, MNB{" "}
                {listDay(row.fxDate)}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      id: "profit",
      header: "Haszon",
      align: "right",
      cell: (row) =>
        row.profitHuf === null || row.profitPercent === null ? (
          "—"
        ) : (
          <span className="flex flex-col items-end">
            <span>{money(row.profitHuf, "Ft")}</span>
            <span className="text-xs text-pilot-grey-500">
              {number(row.profitPercent)}%
            </span>
          </span>
        ),
    },
    {
      id: "list",
      header: "A lista",
      cell: (row) => (
        <span className="flex flex-col">
          <span>{listDay(row.listDate)}</span>
          <span className="text-xs text-pilot-grey-500">
            {row.listAgeDays} napos
          </span>
        </span>
      ),
    },
    {
      id: "match",
      header: "Kötés",
      cell: (row) =>
        row.matchStatus === "AUTO" ? (
          <span title="A rendszer kötötte (vonalkód vagy ismert cikkszám alapján), ember még nem hagyta jóvá.">
            <PilotBadge variant="amber">
              Automatikus, nincs jóváhagyva
            </PilotBadge>
          </span>
        ) : (
          <PilotBadge variant="grey">Jóváhagyva</PilotBadge>
        ),
    },
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-pilot-grey-700">
        {prices.sellingNetHuf === null
          ? `Nettó eladási ár: nincs (${sellingReasonText(prices.sellingReason)}), a haszon nem számítható.`
          : `Nettó eladási ár: ${money(prices.sellingNetHuf, "Ft")}.`}
      </p>
      {converted ? (
        <p className="text-xs text-pilot-grey-600">
          Az árak eltérő pénznemben vannak ({converted.currencies.join(", ")}):
          az összevetés az MNB-árfolyammal forintra átszámolt beszerzési árra
          szól
          {converted.fxDates.length
            ? ` (az árfolyam napja: ${converted.fxDates.map(listDay).join(", ")})`
            : ""}
          .
        </p>
      ) : null}
      {missingRate ? (
        <p className="text-xs text-pilot-grey-600">
          Az árak eltérő pénznemben vannak ({missingRate.join(", ")}), és nem
          mindegyikhez van árfolyam, ezért nem hasonlítjuk össze és nem
          színezzük őket.
        </p>
      ) : null}
      <PilotDataTable
        columns={columns}
        rows={prices.rows}
        rowKey={(row) => `${row.supplierId}:${row.supplierSku}`}
        minWidth={820}
      />
    </div>
  );
}

export function ProductSupplierPricesCard({
  token,
  variantId,
}: {
  token: string;
  variantId: string;
}) {
  const [prices, setPrices] = useState<VariantSupplierPrices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPrices(null);
    setError(null);
    priceListsApi
      .variantPrices(token, variantId, controller.signal)
      .then(setPrices)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A beszállítói árak nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [token, variantId]);

  return (
    <div className="mt-5" data-testid="supplier-prices-card">
      <h3 className="mb-2 text-sm font-semibold text-pilot-grey-900">
        Beszállítói beszerzési árak
      </h3>
      {error ? (
        <Alert
          variant="danger"
          title="A beszállítói árak nem tölthetők be"
          description={error}
        />
      ) : prices === null ? (
        <Skeleton className="h-16 w-full" />
      ) : prices.rows.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          Ehhez a változathoz nincs párosított beszállítói árlista-sor.
        </p>
      ) : (
        <SupplierPricesTable prices={prices} />
      )}
    </div>
  );
}
