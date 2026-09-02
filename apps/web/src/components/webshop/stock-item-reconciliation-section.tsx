"use client";

import { Alert, Card, CardContent, CardHeader, Skeleton } from "@acropora/ui";
import type {
  StockItemReconciliationPage,
  StockItemReconciliationSummary,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { stockItemReconciliationApi } from "@/lib/api/inventory";

/**
 * A TÉTELES KÉSZLET-ÖSSZEVETÉS, A FŐKÖNYVVEL EGYÜTT.
 *
 * MIÉRT ÁLL EGY OLDALON A MÁSIKKAL, ÉS MIÉRT KÜLÖN SZEKCIÓBAN: mert két
 * összevetés van, és eddig csak az egyik látszott. A fenti riport az
 * UNAS-rendelések felől néz, ez pedig a `inventory/reconciliation` modul
 * tételes kimenete -- soronként egy variáns és egy raktár, a FŐKÖNYVVEL is
 * összevetve.
 *
 * MÉRVE 2026-09-01: a felület „készlet-egyeztetés" néven a másikat mutatta, és
 * a javító végpontok EHHEZ tartoznak. Aki ránézett az oldalra, azt hihette,
 * hogy már látja, amit valójában soha nem kértünk le. A két szekció együtt
 * mondja meg, hogy ez két külön kérdés -- egy oldalon, mert ugyanarról a
 * készletről szól, de külön címmel, mert nem ugyanazt méri.
 *
 * AMI SZÁNDÉKOSAN NINCS BENNE: a javítás. A `repair-local` és a
 * `republish-unas` végpont létezik, de előbb legyen látható, HÁNY eltérés van
 * egyáltalán. Lehet, hogy nulla -- és akkor egy javító gomb olyan munka lenne,
 * ami senkinek nem hiányzik. A `republish-unas` ezen felül külső rendszerbe
 * vezet (outbox soron át az UNAS felé), és arról külön döntés kell.
 */
export function StockItemReconciliationSection() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [page, setPage] = useState<StockItemReconciliationPage | null>(null);
  const [summary, setSummary] = useState<StockItemReconciliationSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      stockItemReconciliationApi.page(
        token,
        { pageSize: 25 },
        controller.signal,
      ),
      stockItemReconciliationApi.summary(token, controller.signal),
    ])
      .then(([rows, counts]) => {
        setPage(rows);
        setSummary(counts);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A tételes összevetés nem tölthető be.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-900">
          Tételes összevetés a főkönyvvel
        </h2>
        <span className="text-xs text-slate-500">
          {summary
            ? `${summary.checkedCount} ellenőrzött sor, ${new Date(summary.checkedAt).toLocaleString("hu-HU")}`
            : ""}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          Ez a fenti riporttól KÜLÖN kérdés: itt soronként egy variáns és egy
          raktár áll, a főkönyvből levezetett várt értékkel együtt. A fenti az
          UNAS-rendelések felől néz.
        </p>

        {loading ? <Skeleton className="h-4 w-1/3" /> : null}

        {/*
          HÁROM ÁLLAPOT VAN, NEM KETTŐ. Egy hiba sosem jelenhet meg üres
          listaként: „nincs eltérés" és „nem tudjuk, van-e" két különböző dolog,
          és a második megnyugtatna valakit, akinek nem kellene.
        */}
        {error ? (
          <Alert
            variant="danger"
            title="A tételes összevetés nem tölthető be"
            description={error}
          />
        ) : null}

        {!loading && !error && page && page.items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nincs tételes eltérés. (Ez azt jelenti, hogy a lekérdezés lefutott
            és üres, nem azt, hogy nem néztük meg.)
          </p>
        ) : null}

        {!error && page && page.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cikkszám</th>
                  <th className="px-4 py-3">Raktár</th>
                  <th className="px-4 py-3 text-right">Helyi</th>
                  <th className="px-4 py-3 text-right">Főkönyv szerint</th>
                  <th className="px-4 py-3 text-right">UNAS</th>
                  <th className="px-4 py-3">Állapot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {page.items.map((row) => (
                  <tr key={`${row.variantId}-${row.warehouseId}`}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      {row.sku}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.warehouseCode}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-600">
                      {row.localOnHand ?? "nincs sor"}
                    </td>
                    {/*
                      A NEM BIZONYÍTHATÓ VÁRT ÉRTÉK NEM NULLA ÉS NEM ÜRES.
                      A szerver `null`-t ad, ha a főkönyvből nem vezethető le --
                      és azt ki kell írni, mert egy üres cella tévedésből
                      egyezésnek látszik.
                    */}
                    <td className="px-4 py-3 text-right text-sm text-slate-600">
                      {row.ledgerProvable
                        ? (row.ledgerExpectedOnHand ?? "-")
                        : "nem bizonyítható"}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-600">
                      {row.unasOnHand ?? "nincs kapcsolat"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {page.totalPages > 1 ? (
              <p className="px-5 py-3 text-xs text-slate-500">
                Az első {page.items.length} sor látszik a {page.totalItems}-ből.
                A lapozás és a javítás a következő kör.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
