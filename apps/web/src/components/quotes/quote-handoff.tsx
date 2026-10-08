"use client";

import {
  Alert,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotDataTable,
  PilotDrawer,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import type {
  QuoteDetailDto,
  QuoteHandoffLineDto,
  QuoteHandoffPlanDto,
  QuoteHandoffResultDto,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { quotesApi } from "@/lib/api/quotes";

import { errorText, formatQuoteDay, isAbort } from "./quote-format";

const KIND: Record<QuoteHandoffLineDto["kind"], string> = {
  PRODUCT: "Termék",
  CUSTOM: "Egyedi",
  SERVICE: "Szolgáltatás",
};

/** "2.5" -> "2,5" (a terv tizedes szövegei). */
const qty = (value: string) => value.replace(".", ",");

/**
 * A PROJEKT INDÍTÁSA (#1582 P6). Elfogadott ajánlaton a gomb; ha a projekt
 * már elindult, a száma és az anyagigénye.
 */
export function QuoteHandoffCard({
  quote,
  canHandoff,
  onStart,
}: {
  quote: QuoteDetailDto;
  canHandoff: boolean;
  onStart: () => void;
}) {
  const handoff = quote.handoff;
  if (!handoff && !(quote.status === "ACCEPTED" && canHandoff)) return null;
  return (
    <PilotCard>
      <PilotCardHeader
        title="Projekt"
        action={
          !handoff ? (
            <PilotButton size="regular" onClick={onStart}>
              Projekt indítása
            </PilotButton>
          ) : undefined
        }
      />
      <div className="space-y-2 p-5">
        {handoff ? (
          <>
            <PilotDataRow
              label="Projekt"
              value={`${handoff.projectNumber} · ${handoff.projectName}`}
            />
            <PilotDataRow
              label="Elindította"
              value={`${handoff.executedByName ?? "—"} · ${formatQuoteDay(handoff.executedAt.slice(0, 10))}`}
            />
            <PilotDataRow
              label="Készletből foglalva"
              value={`${handoff.reservationCount} tétel`}
            />
            <PilotDataRow
              label="Anyagigény a hiányra"
              value={
                handoff.materialRequestId ? (
                  <a
                    className="font-semibold text-pilot-aqua-700 underline"
                    href={`/szerviz/anyagigenyek/${encodeURIComponent(handoff.materialRequestId)}`}
                  >
                    Megnyitás
                  </a>
                ) : (
                  "nem kellett"
                )
              }
            />
          </>
        ) : (
          <p className="text-sm text-pilot-grey-600">
            Az elfogadott tételekből projekt indul: ami raktáron van, azt
            lefoglaljuk, a hiány anyagigényként a beszerzéshez kerül.
          </p>
        )}
      </div>
    </PilotCard>
  );
}

/**
 * Az előnézet és az indítás. A terv a raktári helyzetből készül; ha az
 * indításig változik, a szerver 409-et ad, és itt új előnézet töltődik.
 */
export function QuoteHandoffDrawer({
  token,
  quote,
  open,
  canBilling,
  onClose,
  onDone,
}: {
  token: string;
  quote: QuoteDetailDto;
  open: boolean;
  /** P7: may prepare the first milestone's proforma (`billing.create`) */
  canBilling: boolean;
  onClose: () => void;
  onDone: (result: QuoteHandoffResultDto) => void;
}) {
  const hasMilestones = Boolean(
    quote.versions.find((v) => v.id === quote.acceptedVersionId)?.milestones
      .length,
  );
  const [withProforma, setWithProforma] = useState(true);
  const [plan, setPlan] = useState<QuoteHandoffPlanDto | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (excludedWarehouseIds: string[], signal?: AbortSignal) => {
      setError(null);
      try {
        const next = await quotesApi.handoffPreview(token, quote.id, {
          excludedWarehouseIds,
        });
        if (!signal?.aborted) setPlan(next);
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "Az előnézet nem tölthető be."));
      }
    },
    [quote.id, token],
  );

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setNotice(null);
    setExcluded([]);
    setWithProforma(true);
    const controller = new AbortController();
    void load([], controller.signal);
    return () => controller.abort();
  }, [open, load]);

  const toggle = (warehouseId: string, leaveOut: boolean) => {
    const next = leaveOut
      ? [...excluded, warehouseId]
      : excluded.filter((w) => w !== warehouseId);
    setExcluded(next);
    setPlan(null);
    void load(next);
  };

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await quotesApi.handoff(token, quote.id, {
        planHash: plan.planHash,
        excludedWarehouseIds: excluded,
        createProforma: canBilling && hasMilestones && withProforma,
      });
      onDone(result);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setNotice(cause.message);
        setPlan(null);
        await load(excluded);
      } else setError(errorText(cause, "A projekt nem indítható el."));
    } finally {
      setBusy(false);
    }
  };

  const columns: PilotTableColumn<QuoteHandoffLineDto>[] = [
    {
      id: "name",
      header: "Tétel",
      cell: (l) => (
        <span>
          <span className="block font-semibold">{l.name}</span>
          <span className="block text-xs text-pilot-grey-600">
            {KIND[l.kind]}
          </span>
        </span>
      ),
    },
    {
      id: "needed",
      header: "Szükséges",
      align: "right",
      cell: (l) => `${qty(l.needed)} ${l.unit}`,
    },
    {
      id: "fromStock",
      header: "Raktárból",
      align: "right",
      cell: (l) => (l.kind === "PRODUCT" ? qty(l.fromStock) : "—"),
    },
    {
      id: "shortage",
      header: "Anyagigénybe",
      align: "right",
      cell: (l) => (l.kind === "SERVICE" ? "—" : qty(l.shortage)),
    },
  ];

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      title="Projekt indítása"
      subtitle={`${quote.quoteNumber} · ${quote.title}`}
      footer={
        <div className="flex justify-end gap-2">
          <PilotButton variant="ghost" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={!plan || busy} onClick={() => void submit()}>
            Projekt indítása
          </PilotButton>
        </div>
      }
    >
      <div className="space-y-4">
        {notice ? (
          <Alert variant="info" title="A terv frissült" description={notice} />
        ) : null}
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        {!plan ? (
          error ? null : (
            <Skeleton className="h-40 w-full" />
          )
        ) : (
          <>
            <p className="text-sm text-pilot-grey-600">
              Új projekt: <strong>{plan.projectName}</strong>. A raktárban lévő
              mennyiséget lefoglaljuk; a hiány egy anyagigénybe kerül, a
              szolgáltatás csak a listán szerepel.
            </p>
            <PilotDataTable
              columns={columns}
              rows={plan.lines}
              rowKey={(l) => l.quoteBomItemId}
              minWidth={520}
            />
            {plan.reservations.length ? (
              <div className="space-y-1 text-sm">
                <p className="font-semibold">Foglalás raktáranként</p>
                {plan.reservations.map((r) => (
                  <p key={`${r.quoteBomItemId}:${r.stockItemId}`}>
                    {plan.lines.find(
                      (l) => l.quoteBomItemId === r.quoteBomItemId,
                    )?.name ?? ""}
                    : {qty(r.quantity)} · {r.warehouseName}
                  </p>
                ))}
              </div>
            ) : null}
            {canBilling && hasMilestones ? (
              <label className="flex cursor-pointer gap-3 rounded-lg border border-pilot-grey-200 p-3">
                <input
                  type="checkbox"
                  checked={withProforma}
                  onChange={(event) => setWithProforma(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-semibold">
                    Díjbekérő az első mérföldkőből
                  </span>
                  <span className="block text-xs text-pilot-grey-600">
                    Vázlatként készül, ÁFA-kulcsonként egy sorral; a
                    Számlázásban állítható ki.
                  </span>
                </span>
              </label>
            ) : null}
            {plan.warehouses.length > 1 ||
            plan.warehouses.some((w) => w.excluded) ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">
                  Mely raktárakból foglaljunk?
                </legend>
                {plan.warehouses.map((w) => (
                  <label key={w.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!w.excluded}
                      onChange={(event) => toggle(w.id, !event.target.checked)}
                    />
                    <span className="text-sm">{w.name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        )}
      </div>
    </PilotDrawer>
  );
}
