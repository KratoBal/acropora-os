"use client";

import {
  Alert,
  Button,
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
  type StockSyncOutboxRunResult,
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
 *
 * MASODIK KOR (2026-09-03): A LAP EDDIG CSAK NEZTE A SORT, NEM NYULT HOZZA.
 *
 * Az ot vegpontbol a `summary` es a `list` volt bekotve; a ket ADMIN muvelet
 * (`POST :id/retry` es `POST run`) tovabbra is fogyaszto nelkul allt -- a
 * kliensben mar megvolt mind a ketto, csak a kepernyo nem hivta. Ez ugyanaz a
 * szakadas eggyel beljebb: a kepesseg megvan, a felulet megvan, es senki nem
 * koti ossze oket.
 *
 * A hatasa nem elmeleti: egy DEAD_LETTER sort ma SEMMIVEL nem lehetett
 * visszatenni a sorba a feluletrol, es a kikapcsolt munkas mellett gyulo
 * teteleket sem lehetett kezzel kivinni. Mind a ketto ott allt kesz
 * vegpontkent.
 *
 * A HARMADIK LELET, ES EZ NEM HIANY VOLT, HANEM HAMIS JELZES: szurovaltaskor
 * a lap egy pillanatra kiirta, hogy "A tetelek betoltese nem sikerult" --
 * mert a SAJAT megszakitasunk ugyanazon a hiba-agon jott vissza, mint egy
 * valodi halozati hiba. Ez rosszabb a hianynal: egy hibauzenet, ami nem
 * hibarol szol, elobb-utobb megtanitja a nezot, hogy hagyja figyelmen kivul.
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

/**
 * A HAROM KIMENET HAROM KULONBOZO MONDATOT KAP, mert a teendojuk ellentetes.
 *
 * A `"DISABLED"` a legfontosabb, es epp az az alapertelmezes: a munkas
 * kikapcsolva indul, tehat a "Futtatas most" ilyenkor SEMMIT nem csinal. Egy
 * kozos "lefutott" visszajelzes mellett ez ugyanugy nezne ki, mint egy valodi
 * futas -- es a nezo azt hinne, hogy kivitte a tetelekt.
 */
function describeRun(result: StockSyncOutboxRunResult): {
  variant: "info" | "danger";
  title: string;
  description: string;
} {
  if (result === "DISABLED") {
    return {
      variant: "danger",
      title: "Nem futott le semmi",
      description:
        "A kiküldő ki van kapcsolva, ezért a kézi futtatás sem visz ki tételt. Ehhez a UNAS_STOCK_SYNC_WORKER_ENABLED beállítás kell.",
    };
  }
  if (result === "FAILED") {
    return {
      variant: "danger",
      title: "A köteg hibára futott",
      description:
        "A futás elindult, de hibával állt le. A tételek a sorban maradtak, a részletek a szerver naplójában vannak.",
    };
  }
  if (result.claimed === 0) {
    return {
      variant: "info",
      title: "Lefutott, de nem volt kivihető tétel",
      description:
        "A kiküldő elindult, és egyetlen várakozó sort sem talált. Ez nem hiba: a sor üres, vagy a tételek következő próbálkozása még nem járt le.",
    };
  }
  return {
    variant: "info",
    title: "A köteg lefutott",
    description: `Elvéve: ${result.claimed}. Kiment: ${result.succeeded}. Elavult (újabb érték írta felül): ${result.superseded}. Újrapróbálásra ütemezve: ${result.retried}. Feladva: ${result.deadLettered}.`,
  };
}

export function StockSyncOutboxPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  /**
   * A KET MUVELET `inventory.manage`-t kér, nem `view`-t: mindketto IRAST
   * utemez a UNAS fele. Aki csak nezi a sort, a gombokat sem latja -- a
   * szerver ugyanezt 403-mal mondana, de egy letiltott gomb, aminek soha nem
   * lehet oka, csak azt tanitja meg, hogy a lap gombjai nem mukodnek.
   */
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_MANAGE),
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

  /**
   * Egy muvelet utan a SZAMOK is elavulnak, nem csak a lista: egy sikeres
   * futas a PENDING-bol SUCCEEDED-be visz tetelekt, es a fenti kartya ettol
   * meg a regi allast mutatna. A `reloadKey` mindket lekerdezest ujrainditja.
   */
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{
    variant: "info" | "danger";
    title: string;
    description: string;
  } | null>(null);

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

  useEffect(load, [load, reloadKey]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setRowsLoading(true);
    void stockSyncOutboxApi
      .list(token, status ? { status } : {}, controller.signal)
      .then(
        (result) => {
          setRows(result);
          setRowsLoading(false);
        },
        () => {
          /**
           * A MEGSZAKITAS NEM HIBA, ES EDDIG ANNAK LATSZOTT.
           *
           * Szurovaltaskor a cleanup megszakitja az elozo kerest, es a
           * megszakitas ugyanezen a hiba-agon jott vissza: a lap egy
           * pillanatra kiirta, hogy "A tetelek betoltese nem sikerult",
           * mielott az uj valasz beert. Semmi nem romlott el -- mi magunk
           * mondtuk le a kerest.
           *
           * A jel a `signal`, nem a hiba tipusa: ha MI szakitottuk meg, a
           * kepernyo mar a KOVETKEZO kereshez tartozik, nem ehhez.
           *
           * ES AZ ORZO SZANDEKOSAN EGY HELYEN ALL, nem `catch` plusz
           * `finally` parban. Az elso alakjaban ket orzo volt, es egymast
           * fedtek: a hibauzenet ket allapotbol all ossze (`rows === null`
           * ES nem toltunk), tehat barmelyik orzo egyedul is elnyomta --
           * a kalibracios rontas ezert ZOLD maradt, holott az allitas jo
           * volt. Egy vedelem, amit csak KETTOT rontva lehet elsutni,
           * merhetetlen.
           */
          if (controller.signal.aborted) return;
          setRows(null);
          setRowsLoading(false);
        },
      );
    return () => controller.abort();
  }, [canView, status, token, reloadKey]);

  /**
   * A KET MUVELET KOZOS AGA. A hiba SZOVEGE a szerverrol jon (`ApiError`), mert
   * a 403 es a 409 mast jelent, es egy kozos "nem sikerult" mindkettot
   * elfedne.
   */
  const runAction = useCallback(
    async (
      key: string,
      action: () => Promise<{
        variant: "info" | "danger";
        title: string;
        description: string;
      }>,
    ) => {
      setPendingAction(key);
      setActionResult(null);
      try {
        setActionResult(await action());
      } catch (cause: unknown) {
        setActionResult({
          variant: "danger",
          title: "A művelet nem sikerült",
          description:
            cause instanceof Error
              ? cause.message
              : "A kérés feldolgozása nem sikerült.",
        });
      } finally {
        setPendingAction(null);
        setReloadKey((value) => value + 1);
      }
    },
    [],
  );

  const runBatch = useCallback(
    () =>
      runAction("run", async () =>
        describeRun(await stockSyncOutboxApi.run(token)),
      ),
    [runAction, token],
  );

  const retryRow = useCallback(
    (row: StockSyncOutboxRow) =>
      runAction(`retry:${row.id}`, async () => {
        const result = await stockSyncOutboxApi.retry(token, row.id);
        /**
         * A `retried: false` NEM HIBA, es nem is siker: azt jelenti, hogy a sor
         * idokozben kikerult a hibas allapotbol. A szerver szandekosan ezt
         * jelenti vissza ahelyett, hogy sikert allitana -- ha a lap sikernek
         * mutatna, a nezo azt hinne, hogy O inditotta ujra.
         */
        return result.retried
          ? {
              variant: "info" as const,
              title: `${row.sku}: újra sorba állítva`,
              description:
                "A sor várakozó állapotba került, a próbálkozás-számláló nullázva. A kiküldő a következő körben viszi ki.",
            }
          : {
              variant: "danger" as const,
              title: `${row.sku}: nem történt újrapróbálás`,
              description: `A sor időközben kikerült a hibás állapotból (most: ${STATUS_LABELS[result.status]}), ezért nem állítottuk újra sorba.`,
            };
      }),
    [runAction, token],
  );

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

      {actionResult ? (
        <Alert
          variant={actionResult.variant}
          title={actionResult.title}
          description={actionResult.description}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              A kiküldő állapota
            </h2>
            {canManage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => void runBatch()}
              >
                {pendingAction === "run" ? "Futtatás…" : "Futtatás most"}
              </Button>
            ) : null}
          </div>
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
                    <th className="py-1 pr-3">Hiba</th>
                    {canManage ? <th className="py-1">Művelet</th> : null}
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
                      <td className="py-1 pr-3 text-slate-600">
                        {row.lastError ?? "-"}
                      </td>
                      {canManage ? (
                        <td className="py-1">
                          {/*
                            A GOMB CSAK OTT ALL, AHOL A SZERVER IS ENGEDI.
                            A `manualRetry` kizarolag FAILED es DEAD_LETTER
                            sort vesz vissza; barmi mason `retried: false`
                            jonne, tehat egy mindenhol kirakott gomb olyan
                            muveletet igerne, ami sosem tortenik meg.
                          */}
                          {row.status === "FAILED" ||
                          row.status === "DEAD_LETTER" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={pendingAction !== null}
                              onClick={() => void retryRow(row)}
                            >
                              {pendingAction === `retry:${row.id}`
                                ? "Küldés…"
                                : "Újra"}
                            </Button>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      ) : null}
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
