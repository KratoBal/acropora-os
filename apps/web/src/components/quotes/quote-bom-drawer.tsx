"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotDrawer,
  PilotFormField,
  PilotInput,
  PilotSelect,
  type PilotBadgeVariant,
} from "@acropora/ui";
import type {
  QuoteBomItemDto,
  QuoteBomKindValue,
  QuoteBomLineDto,
  QuoteCostingLineDto,
  QuoteDetailDto,
  QuoteInternalBlock,
} from "@acropora/types";
import { useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import {
  errorText,
  formatQuantity,
  formatQuoteDay,
  formatQuoteMoney,
} from "./quote-format";
import { QuoteVariantPicker, type PickedVariant } from "./quote-variant-picker";

type Item = QuoteInternalBlock["items"][number];

const KIND: Record<
  QuoteBomKindValue,
  { label: string; variant: PilotBadgeVariant }
> = {
  PRODUCT: { label: "OS-termék", variant: "blue" },
  CUSTOM: { label: "Egyedi", variant: "amber" },
  SERVICE: { label: "Szolgáltatás", variant: "grey" },
};

const withCost = (row: QuoteBomLineDto): row is QuoteBomItemDto =>
  "unitCost" in row;

/** Egy BOM-sor neve: az egyedi név, vagy a kapcsolt változat neve. */
export function bomLineName(row: QuoteBomLineDto): string {
  return row.customName ?? row.variantLabel ?? "OS-termék";
}

/** A sor költségének forrása egy mondatban (csak költségjoggal látszik). */
export function costSourceText(row: QuoteBomItemDto, currency: string): string {
  if (row.unitCost === null)
    return row.costCurrency && row.costCurrency !== "HUF"
      ? `Nincs költség: ${row.costCurrency} ár árfolyam nélkül.`
      : "Nincs költség.";
  const unitCost = `${formatQuoteMoney(row.unitCost, currency)}/${row.unit}`;
  if (row.costSource === "MANUAL") return `${unitCost} · kézi ár`;
  if (!row.sourcePurchaseInvoiceLineId)
    return `${unitCost} · tartalék (utolsó beszerzési ár)`;
  return `Utolsó beszerzés: ${unitCost} · ${formatQuoteDay(row.costSourceDate)}`;
}

/**
 * A TÉTEL BOM-JA ÉS BELSŐ KALKULÁCIÓJA (#1582 P1; Figma 573:1030 és 573:1283).
 * Minden művelet azonnal ment (a végpont soronként ír), és a válasz a teljes,
 * jogfüggő ajánlat. A költség-mezőket csak `quotes.costs.view` mellett mutatja
 * és írja; a szerver ugyanígy szűr.
 */
export function QuoteBomDrawer({
  open,
  onClose,
  token,
  quoteId,
  versionId,
  currency,
  item,
  rows,
  costing,
  canCosts,
  canCreateProduct,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  quoteId: string;
  versionId: string;
  currency: string;
  item: Item | null;
  rows: readonly QuoteBomLineDto[];
  costing: QuoteCostingLineDto | null;
  canCosts: boolean;
  canCreateProduct: boolean;
  onSaved: (quote: QuoteDetailDto) => void;
}) {
  const [kind, setKind] = useState<QuoteBomKindValue>("PRODUCT");
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [customName, setCustomName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("db");
  const [unitCost, setUnitCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuoteBomLineDto | null>(null);

  const run = async (action: () => Promise<QuoteDetailDto>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      onSaved(await action());
      if (done) setNotice(done);
      return true;
    } catch (cause) {
      setError(errorText(cause, "A művelet nem sikerült."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const ready =
    quantity.trim() &&
    unit.trim() &&
    (kind === "PRODUCT" ? variant : customName.trim());

  const add = async () => {
    if (!item) return;
    const ok = await run(() =>
      quotesApi.addBomItem(token, quoteId, versionId, item.id, {
        kind,
        ...(kind === "PRODUCT"
          ? { variantId: variant!.variantId }
          : { customName: customName.trim() }),
        quantity: quantity.trim(),
        unit: unit.trim(),
        ...(canCosts && kind !== "PRODUCT" && unitCost.trim()
          ? { unitCost: unitCost.trim() }
          : {}),
      }),
    );
    if (ok) {
      setVariant(null);
      setCustomName("");
      setQuantity("1");
      setUnitCost("");
    }
  };

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      width="lg"
      title="BOM és belső kalkuláció"
      subtitle={
        item
          ? `${item.name}: a háttérben OS-termék, egyedi anyag és szolgáltatás is szerepelhet. Ezekből számoljuk az önköltséget.`
          : undefined
      }
      footer={
        <div className="flex justify-end">
          <PilotButton variant="secondary" onClick={onClose}>
            Bezárás
          </PilotButton>
        </div>
      }
    >
      <div className="space-y-5">
        <PilotBadge variant="grey">Csak belső</PilotBadge>
        {error ? (
          <Alert variant="danger" title="Nem sikerült" description={error} />
        ) : null}
        {notice ? (
          <Alert variant="info" title="Kész" description={notice} />
        ) : null}

        {canCosts && costing ? (
          <section
            aria-label="Kalkuláció"
            className="grid grid-cols-2 gap-4 rounded-lg border border-pilot-grey-200 p-4 text-sm"
          >
            <Fact
              label="Anyagköltség (a teljes sorra)"
              value={formatQuoteMoney(costing.bomCost, currency)}
            />
            <Fact
              label="Sor nettó"
              value={formatQuoteMoney(costing.lineNet, currency)}
            />
            <Fact
              label="Fedezet"
              value={
                costing.marginAmount === null
                  ? "—"
                  : `${formatQuoteMoney(costing.marginAmount, currency)} · ${costing.marginPercent ?? "—"}%`
              }
            />
            <Fact
              label="Költség"
              value={costing.bomCostComplete ? "teljes" : "hiányos"}
            />
          </section>
        ) : null}

        <section aria-label="BOM tételek" className="space-y-2">
          <p className="text-xs font-semibold uppercase text-pilot-grey-600">
            BOM tételek
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">Még nincs BOM-sor.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-pilot-grey-200 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <PilotBadge variant={KIND[row.kind].variant}>
                      {KIND[row.kind].label}
                    </PilotBadge>
                    <span className="font-semibold">
                      {bomLineName(row)} × {formatQuantity(row.quantity)}{" "}
                      {row.unit}
                    </span>
                  </div>
                  {withCost(row) ? (
                    <p className="text-xs text-pilot-grey-600">
                      {costSourceText(row, currency)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.kind === "CUSTOM" && canCreateProduct ? (
                    <PilotButton
                      variant="secondary"
                      disabled={busy}
                      aria-label={`${bomLineName(row)}: termékké alakítás`}
                      onClick={() =>
                        void run(async () => {
                          const created =
                            await quotesApi.createProductFromBomItem(
                              token,
                              row.id,
                            );
                          return created.quote;
                        }, "Létrejött a helyi OS-termék, a BOM-sor most erre mutat.")
                      }
                    >
                      Termékké alakítás
                    </PilotButton>
                  ) : null}
                  {row.kind === "PRODUCT" && canCosts ? (
                    <PilotButton
                      variant="ghost"
                      disabled={busy}
                      aria-label={`${bomLineName(row)}: költség frissítése`}
                      onClick={() =>
                        void run(() =>
                          quotesApi.updateBomItem(
                            token,
                            quoteId,
                            versionId,
                            row.id,
                            {
                              refreshCost: true,
                            },
                          ),
                        )
                      }
                    >
                      Költség frissítése
                    </PilotButton>
                  ) : null}
                  <PilotButton
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${bomLineName(row)}: törlés`}
                    onClick={() => setDeleting(row)}
                  >
                    Törlés
                  </PilotButton>
                </div>
              </div>
            ))
          )}
        </section>

        <ConfirmDialog
          open={deleting !== null}
          title={deleting ? `${bomLineName(deleting)} törlése` : ""}
          consequence="A BOM-sor és a hozzá tartozó költség-pillanatkép kikerül ebből a piszkozatból."
          recovery="A sor újra felvehető; a költség ekkor a mai utolsó beszerzésből jön, nem a korábbi pillanatképből."
          confirmLabel="Törlés"
          busy={busy}
          onConfirm={() => {
            const row = deleting;
            setDeleting(null);
            if (row)
              void run(() =>
                quotesApi.deleteBomItem(token, quoteId, versionId, row.id),
              );
          }}
          onCancel={() => setDeleting(null)}
        />
        <section
          aria-label="Tétel hozzáadása"
          className="space-y-3 rounded-lg border border-pilot-grey-200 p-4"
        >
          <p className="text-sm font-semibold text-pilot-aqua-700">
            + Tétel hozzáadása
          </p>
          <PilotFormField label="Fajta">
            <PilotSelect
              chevron
              aria-label="Fajta"
              value={kind}
              onChange={(value) => setKind(value as QuoteBomKindValue)}
            >
              <option value="PRODUCT">
                OS-termék (utolsó beszerzési árral indul)
              </option>
              <option value="CUSTOM">Egyedi termék / anyag</option>
              <option value="SERVICE">Szolgáltatás / egyéb költség</option>
            </PilotSelect>
          </PilotFormField>
          {kind === "PRODUCT" ? (
            <QuoteVariantPicker
              token={token}
              picked={variant}
              onPick={(picked) => {
                setVariant(picked);
                if (picked) setUnit(picked.unit);
              }}
            />
          ) : (
            <PilotFormField label="Megnevezés" required>
              <PilotInput
                aria-label="BOM megnevezés"
                value={customName}
                onChange={setCustomName}
              />
            </PilotFormField>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <PilotFormField label="Mennyiség (a teljes sorra)" required>
              <PilotInput
                aria-label="BOM mennyiség"
                inputMode="decimal"
                value={quantity}
                onChange={setQuantity}
              />
            </PilotFormField>
            <PilotFormField label="Egység" required>
              <PilotInput
                aria-label="BOM egység"
                value={unit}
                onChange={setUnit}
              />
            </PilotFormField>
            {canCosts && kind !== "PRODUCT" ? (
              <PilotFormField label="Nettó egységköltség (Ft)">
                <PilotInput
                  aria-label="BOM egységköltség"
                  inputMode="decimal"
                  value={unitCost}
                  onChange={setUnitCost}
                />
              </PilotFormField>
            ) : null}
          </div>
          <PilotButton
            disabled={!ready || busy || !item}
            onClick={() => void add()}
          >
            Hozzáadás
          </PilotButton>
          <p className="text-xs text-pilot-grey-600">
            Egyedi anyag vagy egyszeri projektköltség a terméktörzs nélkül is a
            BOM-ba tehető. Később egy külön művelettel helyi OS-termék hozható
            létre belőle; automatikusan soha.
          </p>
        </section>
      </div>
    </PilotDrawer>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-pilot-grey-600">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
