"use client";

import {
  Alert,
  PilotButton,
  PilotDrawer,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import {
  EMPTY_QUOTE_RICH_TEXT,
  type QuoteCostingLineDto,
  type QuoteDetailDto,
  type QuoteInternalBlock,
  type QuoteItemSourceValue,
  type QuoteRichText,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText, formatQuoteMoney } from "./quote-format";
import { QuoteVariantPicker, type PickedVariant } from "./quote-variant-picker";

type Item = QuoteInternalBlock["items"][number];

const SOURCES: ReadonlyArray<{
  value: QuoteItemSourceValue;
  label: string;
  help: string;
}> = [
  {
    value: "STANDALONE",
    label: "Önálló ajánlati tétel",
    help: "Nincs mögötte termék vagy BOM; csak ügyféloldali sor.",
  },
  {
    value: "PRODUCT",
    label: "OS-termékhez kapcsolva",
    help: "Egy konkrét OS-termék adatai és utolsó beszerzési ára segíti a kalkulációt.",
  },
  {
    value: "BOM",
    label: "Belső BOM-hoz kapcsolva",
    help: "Több termék, egyedi anyag és szolgáltatás alkotja a háttérkalkulációt.",
  },
];

const SUGGESTION_SOURCE = {
  LIST_PRICE: "a termék mai eladási árából",
  BOM_SUM: "az anyaglista összegéből",
} as const;

/** Van-e a szövegben valódi szöveg (az üres bekezdés nem az). */
export function hasText(node: QuoteRichText | null): boolean {
  if (!node) return false;
  return Boolean(node.text?.trim()) || (node.content ?? []).some(hasText);
}

/**
 * EGY AJÁNLATI TÉTEL SZERKESZTÉSE (#1582 P1; Figma 573:783). A tétel az
 * ügyfélnek látható sor; a forrása mondja meg, mi áll mögötte. Az ár NETTÓ
 * egységár (a modell így tárolja); a tervben álló „Bruttó ajánlati ár” és a
 * „Javasolt ár 30% fedezettel” helyett a javasolt ár a kalkulációból jön,
 * felár-szabály nélkül, a forrását megnevezve (acrobot döntése, 27773).
 */
export function QuoteItemDrawer({
  open,
  onClose,
  token,
  quoteId,
  versionId,
  currency,
  blockId,
  item,
  costing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  quoteId: string;
  versionId: string;
  currency: string;
  /** új tételnél a blokk; meglévőnél null */
  blockId: string | null;
  item: Item | null;
  /** a tétel kalkulációs sora, csak `quotes.costs.view` mellett */
  costing: QuoteCostingLineDto | null;
  onSaved: (quote: QuoteDetailDto) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState(
    JSON.stringify(EMPTY_QUOTE_RICH_TEXT),
  );
  const [source, setSource] = useState<QuoteItemSourceValue>("STANDALONE");
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("db");
  const [unitNetPrice, setUnitNetPrice] = useState("");
  const [vat, setVat] = useState("27");
  const [optional, setOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(item?.name ?? "");
    setDescription(JSON.stringify(item?.description ?? EMPTY_QUOTE_RICH_TEXT));
    setSource(item?.source ?? "STANDALONE");
    setVariant(
      item?.variantId
        ? {
            variantId: item.variantId,
            label: "Kapcsolt OS-termék",
            unit: item.unit,
            vatRate: null,
          }
        : null,
    );
    setQuantity(item?.quantity ?? "1");
    setUnit(item?.unit ?? "db");
    setUnitNetPrice(item?.unitNetPrice ?? "");
    setVat(item?.vatRatePercent ?? "27");
    setOptional(item?.isOptional ?? false);
  }, [item, open]);

  const pickVariant = (picked: PickedVariant | null) => {
    setVariant(picked);
    if (picked) {
      setUnit(picked.unit);
      if (picked.vatRate) setVat(picked.vatRate);
    }
  };

  const ready =
    name.trim() &&
    quantity.trim() &&
    unit.trim() &&
    unitNetPrice.trim() &&
    vat.trim() &&
    (source !== "PRODUCT" || variant);

  const save = async () => {
    setSaving(true);
    setError(null);
    let parsed: QuoteRichText | null = null;
    try {
      parsed = JSON.parse(description) as QuoteRichText;
    } catch {
      parsed = null;
    }
    const body = {
      source,
      variantId: source === "PRODUCT" ? (variant?.variantId ?? null) : null,
      name: name.trim(),
      description: hasText(parsed) ? parsed : null,
      quantity: quantity.trim(),
      unit: unit.trim(),
      unitNetPrice: unitNetPrice.trim(),
      vatRatePercent: vat.trim(),
      isOptional: optional,
    };
    try {
      const quote = item
        ? await quotesApi.updateItem(token, quoteId, versionId, item.id, body)
        : await quotesApi.addItem(token, quoteId, versionId, blockId!, body);
      onSaved(quote);
      onClose();
    } catch (cause) {
      setError(errorText(cause, "A tétel nem menthető."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      width="lg"
      title={item ? "Ajánlati tétel szerkesztése" : "Új ajánlati tétel"}
      subtitle="Az ajánlat sora önálló ügyféloldali elem. A háttérben opcionálisan OS-termékhez vagy belső BOM-hoz kapcsolható."
      footer={
        <div className="flex justify-between gap-3">
          <PilotButton variant="secondary" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={!ready || saving} onClick={() => void save()}>
            Tétel mentése
          </PilotButton>
        </div>
      }
    >
      <div className="space-y-5">
        {error ? (
          <Alert variant="danger" title="Nem sikerült" description={error} />
        ) : null}
        <PilotFormField label="Megnevezés" required>
          <PilotInput aria-label="Megnevezés" value={name} onChange={setName} />
        </PilotFormField>
        <PilotFormField label="Magyarázó szöveg">
          <RichTextEditor
            mode="quote"
            aria-label="Magyarázó szöveg"
            value={description}
            onChange={setDescription}
          />
        </PilotFormField>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase text-pilot-grey-600">
            Tétel forrása
          </legend>
          {SOURCES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer gap-3 rounded-lg border border-pilot-grey-200 p-3"
            >
              <input
                type="radio"
                name="quote-item-source"
                value={option.value}
                checked={source === option.value}
                onChange={() => setSource(option.value)}
              />
              <span>
                <span className="block text-sm font-semibold">
                  {option.label}
                </span>
                <span className="block text-xs text-pilot-grey-600">
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {source === "PRODUCT" ? (
          <PilotFormField label="OS-termék" required>
            <QuoteVariantPicker
              token={token}
              picked={variant}
              onPick={pickVariant}
            />
          </PilotFormField>
        ) : null}

        {costing ? (
          <section
            aria-label="Árképzés"
            className="space-y-2 rounded-lg border border-pilot-grey-200 p-4 text-sm"
          >
            <p className="text-xs font-semibold uppercase text-pilot-grey-600">
              Árképzés
            </p>
            <Row
              label="Kalkulált önköltség"
              value={formatQuoteMoney(costing.bomCost, currency)}
            />
            <Row
              label={
                costing.suggestedPriceSource
                  ? `Javasolt egységár (${SUGGESTION_SOURCE[costing.suggestedPriceSource]}${costing.suggestedPriceComplete ? "" : ", hiányos"})`
                  : "Javasolt egységár"
              }
              value={formatQuoteMoney(costing.suggestedUnitPrice, currency)}
            />
            <Row
              label="Ajánlati egységár (nettó)"
              value={formatQuoteMoney(costing.unitNetPrice, currency)}
            />
            <Row
              label="Tényleges fedezet"
              value={
                costing.marginAmount === null
                  ? "—"
                  : `${formatQuoteMoney(costing.marginAmount, currency)} · ${costing.marginPercent ?? "—"}%`
              }
            />
            {costing.warnings.map((w) => (
              <p key={w} className="text-xs text-pilot-amber-700">
                {w}
              </p>
            ))}
            {costing.suggestedUnitPrice ? (
              <PilotButton
                variant="secondary"
                onClick={() => setUnitNetPrice(costing.suggestedUnitPrice!)}
              >
                Javasolt ár átvétele
              </PilotButton>
            ) : null}
            <p className="text-xs text-pilot-grey-600">
              A fedezet csak tájékoztató adat. Nem blokkolja az ajánlat
              mentését.
            </p>
          </section>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <PilotFormField label="Mennyiség" required>
            <PilotInput
              aria-label="Mennyiség"
              inputMode="decimal"
              value={quantity}
              onChange={setQuantity}
            />
          </PilotFormField>
          <PilotFormField label="Egység" required>
            <PilotInput aria-label="Egység" value={unit} onChange={setUnit} />
          </PilotFormField>
          <PilotFormField label="Nettó egységár" required>
            <PilotInput
              aria-label="Nettó egységár"
              inputMode="decimal"
              value={unitNetPrice}
              onChange={setUnitNetPrice}
            />
          </PilotFormField>
          <PilotFormField label="ÁFA %" required>
            <PilotInput
              aria-label="ÁFA %"
              inputMode="decimal"
              value={vat}
              onChange={setVat}
            />
          </PilotFormField>
        </div>

        <label className="flex cursor-pointer gap-3 rounded-lg border border-pilot-grey-200 p-3">
          <input
            type="checkbox"
            checked={optional}
            onChange={(event) => setOptional(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">
              Opcionális tétel
            </span>
            <span className="block text-xs text-pilot-grey-600">
              Nem számít bele az alap ajánlati összegbe.
            </span>
          </span>
        </label>
      </div>
    </PilotDrawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-pilot-grey-600">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
