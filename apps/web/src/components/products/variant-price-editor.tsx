"use client";

import { Alert, PilotButton, PilotFormField, PilotInput } from "@acropora/ui";
import { formatMoney } from "@acropora/types";
import { useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * A VÁLTOZAT SAJÁT ELADÁSI ÁRA (T4.1-D3, 2. szelet). Csak OS-gazdájú terméknél
 * jelenik meg: ott ez a bolt ára (a vetítés csak ebből olvas), UNAS-gazdánál a
 * tükör ára áll, és egy itt beírt szám nem jutna a boltba. A mentés a szerveren
 * egy tranzakcióban írja az árat és az árelőzményt (Omnibus 30 nap), és a
 * terméket esedékessé teszi a vetítésnek.
 *
 * A beírt szöveg magyar alakot is elfogad (szóköz az ezresek között); a szerver
 * egész forintot kap, mert a felület is egész forintot mutat (barracuda, #2130).
 */
export function normalizePriceInput(text: string): string | null {
  const value = text.replace(/[\s ]/g, "");
  return /^[1-9]\d{0,8}$/.test(value) ? value : null;
}

export function VariantPriceEditor({
  productId,
  variantId,
  sellingGrossPrice,
  sellingPriceCurrency,
  canManage,
  token,
  onSaved,
}: {
  productId: string;
  variantId: string;
  sellingGrossPrice: string | null;
  sellingPriceCurrency: string | null;
  canManage: boolean;
  token: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = sellingGrossPrice
    ? formatMoney(sellingGrossPrice, sellingPriceCurrency ?? "HUF")
    : "Nincs saját ár";

  const save = async () => {
    const value = normalizePriceInput(text);
    if (!value) {
      setError("Az ár pozitív egész forint legyen (például 12 990).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await productApi.setVariantPrice(token, productId, variantId, value);
      setEditing(false);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az ár mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {editing ? (
        <div className="space-y-3">
          <PilotFormField
            label="Saját bruttó eladási ár"
            help="Ezt az árat látja a vevő a webshopban. A változás bekerül az árelőzménybe."
          >
            <PilotInput
              value={text}
              onChange={setText}
              inputMode="decimal"
              placeholder="12 990"
              aria-label="Saját bruttó eladási ár"
            />
          </PilotFormField>
          <div className="flex flex-wrap gap-2">
            <PilotButton onClick={() => void save()} disabled={busy}>
              Ár mentése
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
            <p className="text-xs font-medium text-pilot-grey-500">
              Saját bruttó eladási ár
            </p>
            <p className="mt-1 text-sm font-semibold text-pilot-grey-900">
              {current}
            </p>
          </div>
          {canManage ? (
            <PilotButton
              variant="secondary"
              onClick={() => {
                setText(sellingGrossPrice ?? "");
                setEditing(true);
              }}
            >
              Ár módosítása
            </PilotButton>
          ) : null}
        </div>
      )}
      {error ? (
        <Alert
          variant="danger"
          title="Az ár nem mentődött"
          description={error}
        />
      ) : null}
    </div>
  );
}
