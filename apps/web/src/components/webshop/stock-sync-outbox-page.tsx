"use client";

import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  stockSyncOutboxApi,
  type StockSyncOutboxRow,
  type StockSyncOutboxStatus,
  type StockSyncOutboxSummary,
} from "@/lib/api/inventory";

/**
 * EZ AZ OLDAL EGY SZAKADAST ZAR BE, NEM UJ KEPESSEGET AD.
 *
 * Az ot kimenosor-vegpont 2026-09-02-ig fogyaszto nelkul allt: a summary
 * pontosan azt az alakot adta, amit a #337-ben bekotottunk, es senki nem
 * kerdezte le. Amit emiatt senki nem latott: HANY TETEL TORLODIK, es MIKOR ment
 * ki utoljara keszlet.
 *
 * A LELET PONTOS HATARA, mert menet kozben szukult: nem az, hogy a vevo rossz
 * keszletet lat. A `processForUnasOrder` ut megkeruli a kapcsolot, tehat egy
 * konkret rendeles frissitesenel annak sorai kimennek. Ami a sorban marad:
 * minden MAS keszletvaltozas -- leltar, bolti eladas.
 *
 * EZERT A LEGFONTOSABB ELEM A KEPERNYON A MUNKAS ALLAPOTA, nem a darabszam.
 * Kikapcsolt munkas mellett egy nulla melletti PENDING szam nem azt jelenti,
 * hogy nincs teendo, hanem hogy senki nem viszi ki -- es ez a ket allapot
 * ugyanugy nezne ki, ha csak a szamokat mutatnank.
 */
const STATUS_LABELS: Record<StockSyncOutboxStatus, string> = {
  PENDING: "Várakozik",
  PROCESSING: "Feldolgozás alatt",
  SUCCEEDED: "Kiment",
  FAILED: "Hibás",
  DEAD_LETTER: "Feladva",
};

const STATUS_ORDER: StockSyncOutboxStatus[] = [
  "PENDING",
  "PROCESSING",
  "FAILED",
  "DEAD_LETTER",
  "SUCCEEDED",
];

function formatInterval(intervalMs: number | null): string {
  if (intervalMs === null) return "nincs ütemezés";
  if (intervalMs % 60_000 === 0) return `${intervalMs / 60_000} percenként`;
  return `${Math.round(intervalMs / 1000)} másodpercenként`;
}

/**
 * A "soha" ES a "nem tudjuk" KET KULONBOZO ALLAPOT, es a vegpont `null`-t ad
 * mindkettore. Itt az elso ertelmezes all, mert a mezo neve ezt mondja: ha nincs
 * sikeres publikalas, akkor nem volt.
 */
function formatLastPublish(value: string | null): string {
  if (value === null) return "még soha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU");
}

export function StockSyncOutboxPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );

  const [summary, setSummary] = useState<StockSyncOutboxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * A SZURO ALAPERTELMEZESE URES, ES EZ DONTES: a lap elso kepe a TELJES sor
   * legyen, ne egy szurt reszhalmaz. Egy elore beallitott szuro mellett a nulla
   * talalat ugy nezne ki, mintha nem lenne teendo -- holott csak nem azt
   * kerdeztuk.
   */
  const [status, setStatus] = useState<StockSyncOutboxStatus | "">("");
  const [rows, setRows] = useState<StockSyncOutboxRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);

  const load = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    void stockSyncOutboxApi
      .summary(token)
      .then(setSummary)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A készlet-kimenősor állapotának betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, token]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setRowsLoading(true);
    void stockSyncOutboxApi
      .list(token, status ? { status } : {}, controller.signal)
      .then(setRows)
      .catch(() => setRows(null))
      .finally(() => setRowsLoading(false));
    return () => controller.abort();
  }, [canView, status, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a készlet-kimenősorhoz"
        description="A megnyitáshoz inventory.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Készlet-kimenősor"
        description="A UNAS felé kimenő készletváltozások sora. Azt mutatja, hány tétel várakozik, és mikor ment ki utoljára készlet."
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">
            A kiküldő állapota
          </h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : summary ? (
            <div className="space-y-4">
              {summary.workerEnabled ? (
                <Alert
                  variant="info"
                  title="A kiküldő fut"
                  description={`Ütemezés: ${formatInterval(summary.intervalMs)}.`}
                />
              ) : (
                /**
                 * EZ A LEGFONTOSABB SOR AZ OLDALON. Kikapcsolt munkas mellett a
                 * varakozo tetelek NEM mennek ki magutol, es a szamok ettol meg
                 * ugyanugy neznek ki. A figyelmeztetes NEM hiba: ez egy
                 * beallitas, amit latni kell.
                 *
                 * A `danger` valtozat SZANDEKOS, holott ez nem hiba. Az Alert
                 * ket valtozatot ismer (`info` es `danger`), es a ketto
                 * tevedese nem egyforma: az `info` mellett valaki atfut az
                 * oldalon es ugy erzi, minden rendben van, mikozben a tetelek
                 * gyulnek -- ez NEMA. A `danger` mellett valaki megkerdezi,
                 * elromlott-e, es a szoveg megmondja, hogy nem: ez HANGOS, es
                 * egy mondattal helyre tehető.
                 */
                <Alert
                  variant="danger"
                  title="A kiküldő ki van kapcsolva"
                  description="Ez beállítás, nem hiba. A várakozó tételek viszont nem mennek ki maguktól. Egy konkrét UNAS-rendelés frissítése ettől függetlenül kiviszi a saját sorait; minden más készletváltozás (leltár, bolti eladás) a sorban marad."
                />
              )}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {STATUS_ORDER.map((status) => (
                  <div key={status} className="rounded-md border p-3">
                    <dt className="text-xs text-slate-500">
                      {STATUS_LABELS[status]}
                    </dt>
                    <dd className="text-lg font-semibold text-slate-900">
                      {summary.counts[status] ?? 0}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="text-xs text-slate-500">
                Utoljára kiment készlet:{" "}
                <span className="font-medium text-slate-700">
                  {formatLastPublish(summary.lastSuccessfulPublishAt)}
                </span>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">
            A sor tételei
          </h2>
          <label className="text-xs text-slate-500">
            Állapot:{" "}
            <select
              aria-label="Állapot szűrő"
              className="rounded border px-2 py-1 text-xs"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as StockSyncOutboxStatus | "")
              }
            >
              <option value="">összes</option>
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </CardHeader>
        <CardContent>
          {rowsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : rows === null ? (
            <Alert
              variant="danger"
              title="A tételek betöltése nem sikerült"
              description="A lista nem érhető el. Az összefoglaló ettől függetlenül a fenti kártyán látszik."
            />
          ) : rows.length === 0 ? (
            /**
             * AZ URES ALLAPOT NEM LEHET NEMA (acrobot kikotese, 2026-09-03).
             *
             * Egy "nincs adat" felirat UGYANUGY nez ki akkor, ha tenyleg nincs
             * teendo, es akkor, ha rossz szurovel kerdeztunk. A ket allapot
             * teendoje ELLENTETES, tehat a lapnak ki kell mondania, MIT keresett
             * es MILYEN szurovel -- ugyanaz a szabaly, amit a nulla talalatnal
             * meresre alkalmazunk, csak most a felhasznalo fele.
             */
            <div className="space-y-1 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Nincs találat.</p>
              <p className="text-xs">
                {status
                  ? `A szűrő: ${STATUS_LABELS[status]} állapotú tételek, a legutóbbi 50. Más állapotban lehetnek tételek — válts az "összes" nézetre.`
                  : "A szűrő: minden állapot, a legutóbbi 50 tétel. Ez azt jelenti, hogy a sor üres, nem azt, hogy a lekérdezés nem talált rá."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Cikkszám</th>
                    <th className="py-1 pr-3">Állapot</th>
                    <th className="py-1 pr-3">Cél készlet</th>
                    <th className="py-1 pr-3">Próbálkozás</th>
                    <th className="py-1 pr-3">Következő</th>
                    <th className="py-1">Hiba</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-1 pr-3 font-medium text-slate-900">
                        {row.sku}
                      </td>
                      <td className="py-1 pr-3">{STATUS_LABELS[row.status]}</td>
                      <td className="py-1 pr-3">{row.targetOnHand}</td>
                      <td className="py-1 pr-3">{row.attempts}</td>
                      <td className="py-1 pr-3">
                        {new Date(row.nextAttemptAt).toLocaleString("hu-HU")}
                      </td>
                      {/*
                        A HIBA SZOVEGE TELJES EGESZEBEN LATSZIK, nem levagva: egy
                        csonkolt UNAS-hibauzenetbol nem lehet eldonteni, ugyanaz
                        a hiba ismetlodik-e, vagy egy masik jott.
                      */}
                      <td className="py-1 text-slate-600">
                        {row.lastError ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
