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
    </div>
  );
}
