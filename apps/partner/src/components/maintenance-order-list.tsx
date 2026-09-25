"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  PilotBadge,
  PilotThemeRoot,
  pilotBadgeVariantForTone,
} from "@acropora/ui";
import {
  maintenanceOrderStatusLabel,
  maintenanceOrderStatusTone,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * A MEGRENDELÉSEK LISTÁJA -- Balázs sorrendjének (emlék 1840) 5. része,
 * acrobot jóváhagyása (msg_id 23868, 2026-09-25 22:17 UTC).
 *
 * A FIGMA TERV (`PartnerMegrendelesekList`, `PartnerPortalScreen.tsx:1204-
 * 1240`) NEM MUTAT SEM KERESŐT, SEM FÜLEKET, SEM LAPOZÓT -- ez a lista
 * ezért egyszerű, egy hívással betöltött táblázat, ugyanúgy, ahogy a terv
 * mutatja. A `<Badge variant="proposal">Javaslat</Badge>` és a
 * `<ProposalBanner />` jelölés ELTŰNIK (Balázs döntése szerint, ahogy a
 * Kalkulátoroknál is eltűnt): ez már beépült, nem vázlat.
 *
 * A HELYSZÍN ÉS AZ IDŐSZAK OSZLOP A SZERVERTŐL SZÁRMAZTATOTT ÉRTÉK, nem
 * kliens-oldali számítás -- lásd `MaintenanceOrderPartnerSummary` fejlécét
 * (`@acropora/types`).
 */
export function MaintenanceOrderList() {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.maintenanceOrders>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await partnerApi.maintenanceOrders());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A megrendelések nem tölthetők be.",
      );
    }
  }, []);

  useEffect(() => {
    setError(null);
    void load();
  }, [load]);

  return (
    <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          Szervizmunka
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Megrendelések
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          Az Acropora által kiállított karbantartási megrendelőlapok.
        </p>
      </div>

      {error ? <Message tone="error" text={error} retry={load} /> : null}

      {!data && !error ? (
        <p className="text-sm text-pilot-grey-400">Megrendelések betöltése…</p>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-24 text-center ring-1 ring-pilot-grey-200">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="clipboard" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs megrendelés
          </p>
        </div>
      ) : null}

      {data?.items.length ? (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-pilot-grey-200">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {[
                  "Megrendelés száma",
                  "Szerződés",
                  "Helyszín",
                  "Időszak",
                  "Állapot",
                ].map((head) => (
                  <th
                    key={head}
                    className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((order, index) => (
                <tr
                  key={order.id}
                  className={`border-b border-pilot-grey-100 last:border-0 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/megrendelesek/${order.id}`}
                      className="font-mono text-pilot-grey-900 hover:text-pilot-aqua-700"
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-500">
                    {order.contractNumber}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">
                    {order.departmentName ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">
                    {order.period}
                  </td>
                  <td className="px-5 py-3">
                    <PilotBadge
                      variant={pilotBadgeVariantForTone(
                        maintenanceOrderStatusTone[order.status],
                      )}
                    >
                      {maintenanceOrderStatusLabel[order.status]}
                    </PilotBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
