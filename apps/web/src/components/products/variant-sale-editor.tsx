"use client";

import {
  Alert,
  ConfirmDialog,
  PilotButton,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import { formatMoney } from "@acropora/types";
import { useState } from "react";

import { productApi } from "@/lib/api/products";
import {
  budapestDayOf,
  budapestDayStartIso,
  formatDateTimeHu,
  nextDay,
} from "@/lib/format/date";

import { normalizePriceInput, priceInputOf } from "./variant-price-editor";

/**
 * A VÁLTOZAT SAJÁT AKCIÓJA (T4.1-D3, akció 2. szelet). Csak OS-gazdájú terméknél, a saját ár alatt: amíg az akció
 * fut, a bolt az akciós árat kapja, és az árelőzmény is azt rögzíti (Omnibus). Az akció napokra szól, budapesti
 * idővel: az első nap 0:00-tól az utolsó nap végéig. A szerver félig nyitott ablakot tárol (`[kezdet, vég)`), ezért
 * a vég az utolsó nap UTÁNI nap első pillanata; a kiírás a tárolt két időpontot mutatja, nem a napokat.
 */
export type SaleState = "running" | "planned" | "ended";

export function saleStateOf(
  startsAt: string,
  endsAt: string,
  now: Date,
): SaleState {
  if (now.getTime() >= new Date(endsAt).getTime()) return "ended";
  return now.getTime() >= new Date(startsAt).getTime() ? "running" : "planned";
}

const STATE_TEXT: Record<SaleState, string> = {
  running: "most fut",
  planned: "még nem kezdődött el",
  ended: "véget ért",
};

/**
 * A beírt akció a szerver alakjában, vagy a hiba mondata. A napok budapesti napok; a vég az utolsó nap utáni nap
 * kezdete. A rendes ár alatti szabályt a szerver is őrzi (409), itt csak azért áll, hogy a hiba mentés előtt látsszon.
 */
export function saleRequestOf(
  input: { price: string; firstDay: string; lastDay: string },
  regularPrice: string | null,
): { grossPrice: string; startsAt: string; endsAt: string } | string {
  const grossPrice = normalizePriceInput(input.price);
  if (!grossPrice)
    return "Az akciós ár pozitív egész forint legyen (például 9 990).";
  const regular = Number(regularPrice ?? "NaN");
  if (Number.isFinite(regular) && Number(grossPrice) >= regular)
    return "Az akciós ár a rendes ár alatt legyen.";
  const startsAt = budapestDayStartIso(input.firstDay);
  const endsAt = budapestDayStartIso(nextDay(input.lastDay));
  if (!startsAt || !endsAt) return "Add meg az akció első és utolsó napját.";
  if (input.lastDay < input.firstDay)
    return "Az utolsó nap nem lehet az első nap előtt.";
  return { grossPrice, startsAt, endsAt };
}

export function VariantSaleEditor({
  productId,
  variantId,
  sellingGrossPrice,
  sellingPriceCurrency,
  sellingSaleGrossPrice,
  sellingSaleStartsAt,
  sellingSaleEndsAt,
  canManage,
  token,
  onSaved,
  now = () => new Date(),
}: {
  productId: string;
  variantId: string;
  sellingGrossPrice: string | null;
  sellingPriceCurrency: string | null;
  sellingSaleGrossPrice: string | null;
  sellingSaleStartsAt: string | null;
  sellingSaleEndsAt: string | null;
  canManage: boolean;
  token: string;
  onSaved: () => void;
  now?: () => Date;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [firstDay, setFirstDay] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = sellingPriceCurrency ?? "HUF";
  const sale =
    sellingSaleGrossPrice && sellingSaleStartsAt && sellingSaleEndsAt
      ? {
          price: sellingSaleGrossPrice,
          startsAt: sellingSaleStartsAt,
          endsAt: sellingSaleEndsAt,
        }
      : null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(false);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az akció mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const request = saleRequestOf(
      { price, firstDay, lastDay },
      sellingGrossPrice,
    );
    if (typeof request === "string") {
      setError(request);
      return;
    }
    void run(() =>
      productApi.setVariantSale(token, productId, variantId, request),
    );
  };

  const startEditing = () => {
    const today = budapestDayOf(now());
    setPrice(sale ? priceInputOf(sale.price) : "");
    setFirstDay(sale ? budapestDayOf(sale.startsAt) : today);
    // the stored end is the first moment after the sale: its last day is the day of the moment before it
    setLastDay(
      sale
        ? budapestDayOf(new Date(new Date(sale.endsAt).getTime() - 1))
        : today,
    );
    setError(null);
    setEditing(true);
  };

  if (!sellingGrossPrice)
    return (
      <p className="mt-3 text-sm text-pilot-grey-500">
        Akciót a saját eladási ár megadása után lehet beállítani: az akció ahhoz
        mér.
      </p>
    );

  return (
    <div className="mt-4 space-y-3">
      {editing ? (
        <div className="space-y-3">
          <PilotFormField
            label="Akciós bruttó ár"
            help="Amíg az akció fut, ezt az árat látja a vevő a webshopban, és ez kerül az árelőzménybe."
          >
            <PilotInput
              value={price}
              onChange={setPrice}
              inputMode="decimal"
              placeholder="9 990"
              aria-label="Akciós bruttó ár"
            />
          </PilotFormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <PilotFormField label="Első nap" help="0:00-tól, budapesti idő">
              <PilotInput
                type="date"
                value={firstDay}
                onChange={setFirstDay}
                aria-label="Az akció első napja"
              />
            </PilotFormField>
            <PilotFormField label="Utolsó nap" help="a nap végéig">
              <PilotInput
                type="date"
                value={lastDay}
                onChange={setLastDay}
                aria-label="Az akció utolsó napja"
              />
            </PilotFormField>
          </div>
          <div className="flex flex-wrap gap-2">
            <PilotButton onClick={save} disabled={busy}>
              Akció mentése
            </PilotButton>
            <PilotButton
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
            >
              Mégsem
            </PilotButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-pilot-grey-500">Akció</p>
            {sale ? (
              <p
                className="mt-1 text-sm text-pilot-grey-900"
                data-testid="variant-sale-current"
              >
                <span className="font-semibold">
                  {formatMoney(sale.price, currency)}
                </span>
                {", "}
                {formatDateTimeHu(sale.startsAt)}-tól{" "}
                {formatDateTimeHu(sale.endsAt)}-ig (
                {STATE_TEXT[saleStateOf(sale.startsAt, sale.endsAt, now())]})
              </p>
            ) : (
              <p className="mt-1 text-sm font-semibold text-pilot-grey-900">
                Nincs akció
              </p>
            )}
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <PilotButton variant="secondary" onClick={startEditing}>
                {sale ? "Akció módosítása" : "Akció beállítása"}
              </PilotButton>
              {sale ? (
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Akció törlése
                </PilotButton>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title="Törlöd az akciót?"
        consequence="A bolt a következő vetítéstől a rendes árat mutatja. Ha az akció most fut, az árelőzménybe is a rendes ár kerül."
        recovery="Az akció újra beállítható, ugyanazzal az árral és ugyanazokkal a napokkal."
        confirmLabel="Akció törlése"
        busy={busy}
        onConfirm={() => {
          setConfirmingDelete(false);
          void run(() =>
            productApi.clearVariantSale(token, productId, variantId),
          );
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
      {error ? (
        <Alert
          variant="danger"
          title="Az akció nem mentődött"
          description={error}
        />
      ) : null}
    </div>
  );
}
