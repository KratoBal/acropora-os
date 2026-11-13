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
  formatPercent,
  EMPTY_QUOTE_RICH_TEXT,
  type QuoteCostingLineDto,
  type QuoteDetailDto,
  type QuoteInternalBlock,
  type QuoteItemSourceValue,
  type QuoteRichText,
} from "@acropora/types";
import { useEffect, useRef, useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText, formatQuoteMoney } from "./quote-format";
import { grossFromNet, netFromGross } from "./quote-gross-price";
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

/** A lista-ár hiányának okkódjai (`loadVariantListPrices`), emberi szóval. */
const LIST_PRICE_REASON: Record<string, string> = {
  "price-missing": "a termékhez nincs ár megadva",
  "vat-rate-missing": "a változatnak nincs ÁFA-kulcsa",
  "unknown-variant": "ismeretlen változat",
};

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
  /**
   * A BRUTTÓ EGYSÉGÁR (Luca, 2026-11-13: bolti vásárlónak bruttóban árazunk). A tétel nettót tárol: ha a
   * bruttót írod, abból az ÁFA-kulccsal visszaszámolt nettó megy el; ha a nettót, a bruttó csak mutatja.
   * Az utoljára szerkesztett mező marad fix, ha az ÁFA változik.
   */
  const [unitGrossPrice, setUnitGrossPrice] = useState("");
  /** Mit töltöttünk ki mi magunk a termékválasztáskor: csak azt írjuk felül, amit a felhasználó nem érintett. */
  const autoFilled = useRef({ name: "", price: "" });
  // az aktuális nettó ár, a válasz megérkezésekor: közben beírt árat nem írunk felül
  const netNow = useRef("");
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [priceBase, setPriceBase] = useState<"net" | "gross">("net");
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
            name: item.name,
            unit: item.unit,
            vatRate: null,
          }
        : null,
    );
    setQuantity(item?.quantity ?? "1");
    setUnit(item?.unit ?? "db");
    setUnitNetPrice(item?.unitNetPrice ?? "");
    setUnitGrossPrice(
      grossFromNet(item?.unitNetPrice ?? "", item?.vatRatePercent ?? "27") ??
        "",
    );
    setPriceBase("net");
    setPriceNote(null);
    autoFilled.current = { name: "", price: "" };
    setVat(item?.vatRatePercent ?? "27");
    setOptional(item?.isOptional ?? false);
  }, [item, open]);

  netNow.current = unitNetPrice;
  const changeNet = (value: string) => {
    setPriceBase("net");
    setUnitNetPrice(value);
    setUnitGrossPrice(grossFromNet(value, vat) ?? "");
  };
  const changeGross = (value: string) => {
    setPriceBase("gross");
    setUnitGrossPrice(value);
    setUnitNetPrice(netFromGross(value, vat) ?? "");
  };
  /** Az ÁFA-kulcs változásakor az utoljára szerkesztett ár marad, a másik számolódik újra. */
  const changeVat = (value: string) => {
    setVat(value);
    if (priceBase === "gross")
      setUnitNetPrice(netFromGross(unitGrossPrice, value) ?? "");
    else setUnitGrossPrice(grossFromNet(unitNetPrice, value) ?? "");
  };

  const pickVariant = (picked: PickedVariant | null) => {
    setVariant(picked);
    setPriceNote(null);
    if (!picked) return;
    setUnit(picked.unit);
    if (picked.vatRate) changeVat(picked.vatRate);
    // a megnevezést és az árat a termékből töltjük ki (Luca, 2026-11-13): csak ha a mező üres, vagy az előző
    // termékválasztás töltötte ki, a kézzel beírtat nem írjuk felül
    if (!name.trim() || name === autoFilled.current.name) {
      setName(picked.name);
      autoFilled.current.name = picked.name;
    }
    void quotesApi
      .variantListPrice(token, quoteId, versionId, picked.variantId)
      .then((answer) => {
        const untouched =
          !netNow.current.trim() || netNow.current === autoFilled.current.price;
        if (answer.unitNetPrice === null) {
          setPriceNote(
            `Ehhez a termékhez nincs eladási ár (${LIST_PRICE_REASON[answer.reason ?? ""] ?? answer.reason ?? "ismeretlen ok"}): add meg kézzel.`,
          );
          return;
        }
        if (!untouched) {
          setPriceNote(
            "A beírt árat nem írtam felül. A termék mai eladási ára: " +
              `${answer.unitNetPrice} Ft nettó.`,
          );
          return;
        }
        changeNet(answer.unitNetPrice);
        autoFilled.current.price = answer.unitNetPrice;
        setPriceNote(
          answer.sale
            ? "Az ár a termék most futó akciós árából jött."
            : "Az ár a termék mai eladási ára.",
        );
      })
      .catch((cause: unknown) =>
        setPriceNote(errorText(cause, "A termék ára nem tölthető be.")),
      );
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
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
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
            {priceNote ? (
              <p role="status" className="mt-2 text-xs text-pilot-grey-600">
                {priceNote}
              </p>
            ) : null}
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
              value={formatQuoteMoney(costing.suggestedUnitPrice, currency, {
                fractionDigits: 2,
              })}
            />
            <Row
              label="Ajánlati egységár (nettó)"
              value={formatQuoteMoney(costing.unitNetPrice, currency, {
                fractionDigits: 2,
              })}
            />
            <Row
              label="Tényleges fedezet"
              value={
                costing.marginAmount === null
                  ? "—"
                  : `${formatQuoteMoney(costing.marginAmount, currency)} · ${formatPercent(costing.marginPercent, 2)}`
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
                onClick={() => changeNet(costing.suggestedUnitPrice!)}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
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
              onChange={changeNet}
            />
          </PilotFormField>
          <PilotFormField
            label="Bruttó egységár"
            help={
              unitGrossPrice.trim() && !netFromGross(unitGrossPrice, vat)
                ? "Az összeg csak szám lehet, szóköz nélkül (pl. 1270 vagy 1270,50)."
                : "Ha ezt írod, a nettó az ÁFA-kulccsal visszaszámolva kerül a tételre."
            }
          >
            <PilotInput
              aria-label="Bruttó egységár"
              inputMode="decimal"
              value={unitGrossPrice}
              onChange={changeGross}
            />
          </PilotFormField>
          <PilotFormField label="ÁFA %" required>
            <PilotInput
              aria-label="ÁFA %"
              inputMode="decimal"
              value={vat}
              onChange={changeVat}
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
