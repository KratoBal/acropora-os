"use client";

import { Alert, Button, Skeleton } from "@acropora/ui";
import type { ReceiptsResponse } from "@acropora/types";
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
export function BillingReceiptsView({ token }: { token: string }) {
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
