"use client";

import { Alert, Button, Skeleton } from "@acropora/ui";
import type {
  ReceiptsResponse,
  CashRegisterReceiptListResponse,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";

const COLUMNS = [
  "Nyugtaszám",
  "Kelt",
  "Fizetési mód",
  "Pénznem",
  "Végösszeg",
  "Állapot",
];

/**
 * A NYUGTÁK NÉZETE A C SZELETIG (Figma 374:1033; Balázs promptja, 10-14. pont):
 * a nyugták mezőit az első valódi napi köteg auditja után képezzük le, addig
 * mezőt nem találunk ki. Ez ISMERT, NEM HIBA állapot, és a doboz megmondja,
 * melyik: ha még nem jött nyugta, azt; ha jött, de a mezőkészlet még nincs
 * auditálva, azt, a darabszámmal (nem egy üres listát).
 *
 * Szűrő itt nincs: amíg egy mező sincs leképezve, egy szűrő semmit nem szűrne.
 */
function SzamlazzReceiptsView({ token }: { token: string }) {
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        setData(await billingDocumentsApi.receipts(token, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A nyugták állapota nem tölthető be.",
          );
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error)
    return (
      <Alert
        variant="danger"
        title="Betöltési hiba"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );
  if (!data)
    return <Skeleton aria-label="Nyugták betöltése" className="h-40" />;

  const received = data.received;
  return (
    <>
      <section
        role="status"
        className="rounded-2xl border border-pilot-accent-warm bg-pilot-accent-warm-soft px-5 py-4"
      >
        <p className="text-sm font-semibold text-pilot-accent-warm-text">
          {received === 0
            ? "Még nem érkezett nyugta az adatkapcsolaton"
            : `${received.toLocaleString("hu-HU")} nyugta érkezett az adatkapcsolaton`}
        </p>
        <p className="mt-1 text-xs text-pilot-grey-600">
          {received === 0
            ? "A pontos mezőkészletet az első napi köteg után véglegesítjük."
            : "A mezőkészletet még nem auditáltuk, ezért a nyugták még nem jelennek meg. Az audit után ezen a nézeten látszanak."}
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
        <div
          aria-hidden="true"
          className="hidden grid-cols-6 bg-pilot-grey-100 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.04em] text-pilot-grey-500 md:grid"
        >
          {COLUMNS.map((column) => (
            <span key={column}>{column}</span>
          ))}
        </div>
        <div className="flex flex-col items-center gap-2.5 px-5 py-20 text-center">
          <p className="text-sm font-semibold text-pilot-grey-900">
            Még nincs megjeleníthető nyugta
          </p>
          <p className="max-w-[560px] text-sm text-pilot-grey-600">
            {received === 0
              ? "Amint megérkezik az első napi köteg, ezen a nézeten jelennek meg a nyugták és véglegesítjük a további oszlopokat."
              : "A beérkezett nyugták az audit után jelennek meg ezen a nézeten, a véglegesített oszlopokkal."}
          </p>
        </div>
      </section>
    </>
  );
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Készpénz",
  CARD: "Bankkártya",
  OTHER: "Egyéb",
  UNKNOWN: "Nem besorolt / kerekítés",
};
const amount = (value: string) =>
  new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value));
function paymentLabel(value: string) {
  return value
    .split("+")
    .map((v) => PAYMENT_LABELS[v] ?? v)
    .join(" + ");
}
function CashRegisterReceiptsView({ token }: { token: string }) {
  const [day, setDay] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Budapest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [page, setPage] = useState(1),
    [data, setData] = useState<CashRegisterReceiptListResponse | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    void billingDocumentsApi
      .cashRegisterReceipts(token, day, page, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "A nyugták nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [token, day, page, retry]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm font-medium text-pilot-grey-900">
          Nap
          <input
            aria-label="Nyugták napja"
            type="date"
            required
            value={day}
            onChange={(e) => {
              if (e.target.value) {
                setDay(e.target.value);
                setPage(1);
              }
            }}
            className="mt-1 block rounded-lg border border-pilot-grey-300 bg-white px-3 py-2"
          />
        </label>
        <p className="text-xs text-pilot-grey-600">
          NAV OPG · magyar idő szerint · HUF
        </p>
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>
              Újrapróbálás
            </Button>
          }
        />
      ) : !data ? (
        <Skeleton
          aria-label="Pénztárgépes nyugták betöltése"
          className="h-40"
        />
      ) : (
        <>
          {data.lastRun?.status === "FAILED" && (
            <Alert
              variant="danger"
              title="A legutóbbi pénztárgépes szinkron sikertelen"
              description={`A lista hiányos lehet. Hibakód: ${data.lastRun.errorCode ?? "ismeretlen"}`}
            />
          )}
          {data.gaps.length > 0 && (
            <Alert
              variant="danger"
              title="Hiányzó pénztárgépfájlok"
              description={data.gaps
                .map(
                  (g) =>
                    `${g.apNumber}: ${g.fromFileNumber}–${g.toFileNumber} (a NAV megőrzési idejéből kiesett)`,
                )
                .join("; ")}
            />
          )}
          {!data.lastRun && (
            <Alert
              title="Még nem futott pénztárgépes szinkron"
              description="Az első visszatöltés után jelennek meg az elérhető nyugták."
            />
          )}
          <section
            aria-label="Napi összesítés"
            className="rounded-2xl border border-pilot-grey-200 bg-white p-5"
          >
            <p className="text-xs text-pilot-grey-600">
              Napi bevétel egyenlege · a sztornók és visszáruk levonva, a törölt
              nyugták kizárva
            </p>
            <p className="mt-1 text-2xl font-semibold text-pilot-grey-900">
              {amount(data.summary.total)}
            </p>
            <p className="mt-1 text-xs text-pilot-grey-600">
              {data.summary.count} figyelembe vett bizonylat
            </p>
            <div className="mt-4 flex flex-wrap gap-6">
              {data.summary.payments.map((p) => (
                <div key={p.category}>
                  <p className="text-xs text-pilot-grey-600">
                    {paymentLabel(p.category)}
                  </p>
                  <p className="text-sm font-semibold">{amount(p.amount)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="overflow-x-auto rounded-2xl border border-pilot-grey-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-pilot-grey-100 text-xs text-pilot-grey-600">
                <tr>
                  {[
                    "Nyugtaszám / AP",
                    "Kelt",
                    "Fizetési mód",
                    "Végösszeg",
                    "Állapot",
                  ].map((v) => (
                    <th key={v} className="px-4 py-3">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-t border-pilot-grey-200">
                    <td className="px-4 py-4">
                      <details>
                        <summary className="cursor-pointer font-medium">
                          {r.receiptNumber}
                        </summary>
                        <p className="mt-1 text-xs text-pilot-grey-600">
                          {r.apNumber}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {r.lines.map((l, i) => (
                            <li key={i}>
                              {l.quantity} × {l.name} · {amount(l.sum)} ·{" "}
                              {l.vatCode}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {new Intl.DateTimeFormat("hu-HU", {
                        timeZone: "Europe/Budapest",
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(r.issuedAt))}
                    </td>
                    <td className="px-4 py-4">
                      {paymentLabel(r.paymentMeans)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-medium">
                      {amount(r.total)}
                    </td>
                    <td className="px-4 py-4">
                      {r.cancelled
                        ? "Törölt"
                        : r.kind === "STORNO"
                          ? "Sztornó"
                          : r.kind === "RETURN"
                            ? "Visszáru"
                            : "Eladás"}
                      {r.validationCode === "WARN" && (
                        <span className="block text-xs text-pilot-accent-warm-text">
                          NAV figyelmeztetés
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.items.length === 0 && (
              <p className="px-5 py-14 text-center text-pilot-grey-600">
                Ezen a napon nincs eltárolt pénztárgépes nyugta.
              </p>
            )}
          </section>
          {data.total > data.pageSize && (
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((v) => v - 1)}
              >
                Előző
              </Button>
              <span className="text-sm">
                {page} / {Math.ceil(data.total / data.pageSize)}
              </span>
              <Button
                variant="secondary"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage((v) => v + 1)}
              >
                Következő
              </Button>
            </div>
          )}
          <p className="text-xs text-pilot-grey-600">
            {data.lastRun
              ? `Legutóbbi futás: ${new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" }).format(new Date(data.lastRun.startedAt))} · ${data.lastRun.status === "RUNNING" ? "folyamatban" : data.lastRun.status === "SUCCEEDED" ? "sikeres" : "sikertelen"}`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
export function BillingReceiptsView({ token }: { token: string }) {
  const [source, setSource] = useState<"cash" | "szamlazz">("cash");
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Nyugták forrása" className="flex gap-2">
        <Button
          variant={source === "cash" ? "primary" : "secondary"}
          aria-pressed={source === "cash"}
          onClick={() => setSource("cash")}
        >
          Pénztárgép
        </Button>
        <Button
          variant={source === "szamlazz" ? "primary" : "secondary"}
          aria-pressed={source === "szamlazz"}
          onClick={() => setSource("szamlazz")}
        >
          Számlázz.hu
        </Button>
      </div>
      {source === "cash" ? (
        <CashRegisterReceiptsView token={token} />
      ) : (
        <SzamlazzReceiptsView token={token} />
      )}
    </div>
  );
}
