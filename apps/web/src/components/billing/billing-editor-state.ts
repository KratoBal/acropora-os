import {
  computeBillingDocumentAmounts,
  getDocumentCapabilities,
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  szamlazzUnitNetFromGross,
  type BillingAmountsResult,
  type BillingProductPrice,
  type BillingDocumentCustomer,
  type BillingDocumentDetail,
  type BillingDocumentDraftInput,
  type BillingDocumentType,
  type BillingSourceType,
  type InvoiceFormat,
} from "@acropora/types";

/**
 * A SZÁMLÁZÁSI SZERKESZTŐ ÁLLAPOTA, TISZTA FÜGGVÉNYEKKEL (Számlázás v0.1).
 *
 * Egy szerkesztő, négy bizonylattípus (brief 6. pont): a típus nem új oldalt
 * nyit, hanem a képesség-tábla (`getDocumentCapabilities`) szerint mást mutat.
 *
 * === A TÍPUSVÁLTÁS NEM TÖRÖL (brief 23. pont) ===
 *
 * A partner, a tételek, a forrás és a megjegyzés közös, tehát maradnak. Ami
 * egy típusnál nem értelmezett (a szállítólevél fizetési mezői, a díjbekérő
 * formátuma), az ELREJTŐDIK, de az értéke az állapotban megmarad: a szerverre
 * nem megy el, és visszaváltáskor visszajön. Így semmi nem vész el csendben,
 * és nincs mit megerősíttetni; a felület egy mondatban megmondja, mi rejtőzött el.
 */
export interface EditorLine {
  /** Helyi kulcs a listához; a tárolt sor azonosítója az `id`. */
  key: string;
  id?: string;
  productId: string | null;
  /**
   * A TERMÉK VÁLTOZATA (kártya 705768fc): több változatú terméknél ez mondja
   * meg, melyik készlete csökken a kiállításkor. Egyváltozatú terméknél és
   * egyedi tételnél üres.
   */
  variantId?: string | null;
  /**
   * A termék aktív változatai, ha egynél több van (a termék adataiból töltődik);
   * csak a felületé, nem megy el. `undefined`: még nincs betöltve.
   */
  variantOptions?: { id: string; label: string }[];
  /** A termék-sor alcíme (cikkszám); egyedi tételnél `null`. */
  productLabel: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  discountPercent: string;
  comment: string;
  /**
   * A BEÍRT BRUTTÓ, ha a sort bruttóból töltötték ki (Balázs a stage-en,
   * 2026-09-30). Csak bevitel: a mentés a belőle számolt `unitNet`-et küldi.
   * A mennyiség, a nettó egységár vagy a kulcs szerkesztése törli, onnantól a
   * bruttó megint a nettóból következik.
   */
  grossInput?: string;
  /**
   * MIÉRT NEM TÖLTŐDÖTT KI A TERMÉK ÁRA (`billingProductPrice` indoka). Csak a
   * felületnek szól; az egységár kézi kitöltése eltünteti.
   */
  priceNote?: string;
}

export interface EditorState {
  /** A vázlat azonosítója. Új vázlatnál a kliens adja (idempotens létrehozás). */
  id: string;
  /** A legutóbbi mentés időbélyege; `null`, amíg a vázlat nincs elmentve. */
  savedUpdatedAt: string | null;
  documentType: BillingDocumentType;
  /**
   * A VÁLASZTOTT formátum. Ahol a típusnak nincs formátuma, ez nem megy el,
   * de megmarad (lásd `effectiveFormat`).
   */
  preferredFormat: InvoiceFormat;
  customer: BillingDocumentCustomer | null;
  fulfillmentDate: string;
  dueDate: string;
  paymentMethod: string;
  currency: string;
  language: string;
  reference: string;
  note: string;
  sourceType: BillingSourceType | null;
  sourceId: string | null;
  lines: EditorLine[];
}

export const PAYMENT_METHODS = ["Átutalás", "Készpénz", "Bankkártya"] as const;
export const CURRENCIES = ["HUF", "EUR"] as const;
export const LANGUAGES = [
  { value: "hu", label: "Magyar" },
  { value: "en", label: "Angol" },
  { value: "de", label: "Német" },
] as const;

/** A fizetési határidő alapértéke: a teljesítés után nyolc nappal (Figma). */
const DEFAULT_PAYMENT_DAYS = 8;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let keyCounter = 0;
export function newLineKey(): string {
  keyCounter += 1;
  return `line-${keyCounter}`;
}

export function emptyLine(
  overrides: Partial<Omit<EditorLine, "key">> = {},
): EditorLine {
  return {
    key: newLineKey(),
    productId: null,
    productLabel: null,
    description: "",
    quantity: "1",
    unit: "db",
    unitNet: "",
    vatRatePercent: "27",
    discountPercent: "",
    comment: "",
    ...overrides,
  };
}

export function newEditorState(input: {
  id: string;
  today: string;
  documentType?: BillingDocumentType;
  sourceType?: BillingSourceType | null;
  sourceId?: string | null;
}): EditorState {
  return {
    id: input.id,
    savedUpdatedAt: null,
    documentType: input.documentType ?? "INVOICE",
    preferredFormat: "ELECTRONIC",
    customer: null,
    fulfillmentDate: input.today,
    dueDate: addDays(input.today, DEFAULT_PAYMENT_DAYS),
    paymentMethod: PAYMENT_METHODS[0],
    currency: "HUF",
    language: "hu",
    reference: input.sourceId ?? "",
    note: "",
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    lines: [],
  };
}

/** A ténylegesen érvényes formátum: `null`, ahol a típusnak nincs formátuma. */
export function effectiveFormat(state: EditorState): InvoiceFormat | null {
  const { formats, defaultFormat } = getDocumentCapabilities(
    state.documentType,
  );
  if (formats.length === 0) return null;
  return formats.includes(state.preferredFormat)
    ? state.preferredFormat
    : defaultFormat;
}

/**
 * MIT REJT EL A TÍPUS, ami ki volt töltve. A felület ezt mondja ki a választó
 * alatt; üres lista esetén nincs mit mondani.
 */
export function hiddenFilledFields(state: EditorState): string[] {
  const { showsPaymentFields } = getDocumentCapabilities(state.documentType);
  if (showsPaymentFields) return [];
  return [
    ...(state.dueDate ? ["fizetési határidő"] : []),
    ...(state.paymentMethod ? ["fizetési mód"] : []),
  ];
}

/** A tárolt vázlatból a szerkesztő állapota. */
export function fromDetail(detail: BillingDocumentDetail): EditorState {
  const discounts = new Map(
    detail.lines
      .filter((line) => line.kind === "DISCOUNT" && line.parentLineId)
      .map((line) => [line.parentLineId!, line]),
  );
  return {
    id: detail.id,
    savedUpdatedAt: detail.updatedAt,
    documentType: detail.documentType,
    preferredFormat: detail.invoiceFormat ?? "ELECTRONIC",
    customer: detail.customer,
    fulfillmentDate: detail.fulfillmentDate ?? "",
    dueDate: detail.dueDate ?? "",
    paymentMethod: detail.paymentMethod ?? "",
    currency: detail.currency,
    language: detail.language,
    reference: detail.reference ?? "",
    note: detail.note ?? "",
    sourceType: detail.sourceType,
    sourceId: detail.sourceId,
    lines: detail.lines
      .filter((line) => line.kind === "ITEM")
      .map((line) => ({
        key: newLineKey(),
        id: line.id,
        productId: line.productId,
        variantId: line.variantId ?? null,
        productLabel: null,
        description: line.description,
        quantity: trimDecimal(line.quantity),
        unit: line.unit ?? "",
        unitNet: trimDecimal(line.unitNet),
        vatRatePercent: trimDecimal(line.vatRatePercent),
        discountPercent: trimDecimal(
          line.discountPercent ?? discounts.get(line.id)?.discountPercent ?? "",
        ),
        comment: line.comment ?? "",
      })),
  };
}

/**
 * A termék aktív változatai a választóhoz: csak ha egynél több van, mert
 * egyetlen változatnál nincs mit választani (a kiállítás azt mozgatja).
 */
export function variantOptionsOf(
  variants: readonly {
    id: string;
    sku: string;
    name: string | null;
    isActive: boolean;
  }[],
): { id: string; label: string }[] {
  const active = variants.filter((variant) => variant.isActive);
  return active.length > 1
    ? active.map((variant) => ({
        id: variant.id,
        label: variant.name ? `${variant.sku} · ${variant.name}` : variant.sku,
      }))
    : [];
}

/** "12.500000" -> "12.5", "0.0000" -> "0": a mező ne a tárolás skáláját mutassa. */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

const blank = (value: string) => (value.trim() === "" ? null : value.trim());

/**
 * A MENTÉS TÖRZSE. A rejtett mezők NEM mennek el (a szerver is eldobná őket,
 * de a felület ne küldjön értelmetlen mezőt, brief 5. pont). Összeg nincs
 * benne: a szerver számol.
 */
export function toDraftInput(
  state: EditorState,
  mode: "create" | "update",
): BillingDocumentDraftInput {
  const { showsPaymentFields } = getDocumentCapabilities(state.documentType);
  return {
    ...(mode === "create"
      ? { id: state.id }
      : { expectedUpdatedAt: state.savedUpdatedAt ?? undefined }),
    documentType: state.documentType,
    invoiceFormat: effectiveFormat(state),
    customerId: state.customer?.id ?? "",
    fulfillmentDate: blank(state.fulfillmentDate),
    dueDate: showsPaymentFields ? blank(state.dueDate) : null,
    paymentMethod: showsPaymentFields ? blank(state.paymentMethod) : null,
    currency: state.currency,
    language: state.language,
    reference: blank(state.reference),
    note: blank(state.note),
    sourceType: state.sourceType,
    sourceId: state.sourceId,
    lines: state.lines.map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      productId: line.productId,
      variantId: line.productId ? (line.variantId ?? null) : null,
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      unit: blank(line.unit),
      unitNet: line.unitNet.trim(),
      vatRatePercent: line.vatRatePercent.trim(),
      discountPercent: blank(line.discountPercent),
      comment: blank(line.comment),
    })),
  };
}

/**
 * AZ ÉLŐ SZÁMÍTÁS, a szerverével azonos függvénnyel. Egy még üres egységár
 * nem hiba, hanem kitöltetlen sor: nullával számol, hogy az összesítő ne
 * tűnjön el gépelés közben; a mentés a szerveren úgyis a valódi értéket méri.
 */
export function liveAmounts(state: EditorState): BillingAmountsResult {
  return computeBillingDocumentAmounts(
    state.lines.map((line) => ({
      quantity: line.quantity.trim() || "0",
      unitNet: line.unitNet.trim() || "0",
      vatRatePercent: line.vatRatePercent.trim() || "0",
      discountPercent: blank(line.discountPercent),
    })),
  );
}

export interface PreviewAmounts {
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface BillingPreview {
  /** Soronként, a szerkesztő sorrendjében; a kedvezmény a tétele mellett. */
  lines: { item: PreviewAmounts; discount: PreviewAmounts | null }[];
  totals: PreviewAmounts;
  byVatRate: (PreviewAmounts & { vatRatePercent: string })[];
  /** Azok a sorok (a szerkesztő sorszáma, 0-tól), amik 0 Ft-ra kerekülnek. */
  zeroForintLines: number[];
}

/**
 * AZ ÖSSZEG, AHOGY A SZÁMLÁN ÁLLNI FOG (#1275, nautilus mérése a Számlázz.hu
 * tesztfiókján, 14 válasz). A sor a Számlázz.hu soronkénti szabályával
 * (`szamlazzLineAmounts`), a bizonylat összege a forint-kerekítésével
 * (`szamlazzDocumentTotals`): tételenként kerekített bruttó és ÁFA, a nettó a
 * kettő különbsége. A kiállítás ugyanezzel számol, tehát a felület pontosan
 * azt a bruttót mutatja, amit a számla kiír.
 *
 * A KEDVEZMÉNY-SOR ugyanúgy megy, mint a kiállításnál: mennyiség 1, egységára
 * a tétel alatti negatív nettó (`computeBillingDocumentAmounts`).
 *
 * `null`: valamelyik szám nem érvényes (a hibát a szerver mentéskor megnevezi).
 */
export function billingPreview(state: EditorState): BillingPreview | null {
  const base = liveAmounts(state);
  if (!base.ok) return null;
  const number = (value: string, fallback: string) =>
    (value.trim() || fallback).replace(",", ".");
  const flat: {
    lineIndex: number;
    rate: string;
    amounts: PreviewAmounts;
  }[] = [];
  const lines: BillingPreview["lines"] = [];
  for (const [index, line] of state.lines.entries()) {
    const rate = number(line.vatRatePercent, "0");
    const item = szamlazzLineAmounts({
      quantity: number(line.quantity, "0"),
      unitNet: number(line.unitNet, "0"),
      vatRatePercent: rate,
      currency: state.currency,
    });
    if (!item.ok) return null;
    const computedDiscount = base.amounts.lines[index]!.discount;
    let discount: PreviewAmounts | null = null;
    if (computedDiscount) {
      const result = szamlazzLineAmounts({
        quantity: "1",
        unitNet: computedDiscount.netAmount,
        vatRatePercent: rate,
        currency: state.currency,
      });
      if (!result.ok) return null;
      discount = result;
    }
    lines.push({ item, discount });
    flat.push({ lineIndex: index, rate, amounts: item });
    if (discount) flat.push({ lineIndex: index, rate, amounts: discount });
  }

  const totals = szamlazzDocumentTotals(
    flat.map((entry) => entry.amounts),
    state.currency,
  );
  const rates = [...new Set(flat.map((entry) => entry.rate))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return {
    lines,
    totals,
    // KULCSONKÉNT UGYANAZ A FÜGGVÉNY: a soronkénti kerekítés miatt a kulcsok
    // összege pontosan a végösszeg.
    byVatRate: rates.map((rate) => ({
      vatRatePercent: rate,
      ...szamlazzDocumentTotals(
        flat.filter((entry) => entry.rate === rate).map((e) => e.amounts),
        state.currency,
      ),
    })),
    zeroForintLines: [
      ...new Set(
        totals.zeroForintLines.map((position) => flat[position]!.lineIndex),
      ),
    ],
  };
}

/** Mi hiányzik a mentéshez; üres lista: menthető. */
export function missingForSave(state: EditorState): string[] {
  return [
    ...(state.customer ? [] : ["partner"]),
    ...(state.lines.length === 0 ? ["legalább egy tétel"] : []),
    ...(state.lines.some((line) => !line.description.trim())
      ? ["minden tétel megnevezése"]
      : []),
    ...(state.lines.some((line) => !line.unitNet.trim())
      ? ["minden tétel nettó egységára"]
      : []),
  ];
}

/** Pénz megjelenítése: forint egészre, más pénznem két tizedesre. */
export function formatMoney(value: string, currency: string): string {
  const number = Number(value);
  const digits = currency === "HUF" ? 0 : 2;
  const formatted = new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
  return currency === "HUF" ? `${formatted} Ft` : `${formatted} ${currency}`;
}

/**
 * EGY SOR KITÖLTÉSE BRUTTÓBÓL. A nettó egységár a Számlázz.hu szabályával
 * számolódik vissza (`szamlazzUnitNetFromGross`); amíg a bruttó nem szám
 * (gépelés közben), a nettó egységár nem változik, üres bruttónál kiürül.
 */
export function withGrossInput(
  line: EditorLine,
  grossInput: string,
  currency: string,
): EditorLine {
  if (!grossInput.trim()) return { ...line, grossInput, unitNet: "" };
  const result = szamlazzUnitNetFromGross({
    grossAmount: grossInput.trim(),
    quantity: line.quantity.trim(),
    vatRatePercent: line.vatRatePercent.trim() || "0",
    currency,
  });
  return result.ok
    ? { ...line, grossInput, unitNet: result.unitNet }
    : { ...line, grossInput };
}

/**
 * HA A BEÍRT BRUTTÓ NEM JÖN KI PONTOSAN: a bruttó, ami a számlán állni fog
 * (két tizedesen, a tétel szintjén). `null`: nincs beírt bruttó, vagy pontos.
 */
export function grossInputMismatch(
  line: EditorLine,
  currency: string,
): string | null {
  if (!line.grossInput?.trim()) return null;
  const result = szamlazzUnitNetFromGross({
    grossAmount: line.grossInput.trim(),
    quantity: line.quantity.trim(),
    vatRatePercent: line.vatRatePercent.trim() || "0",
    currency,
  });
  return result.ok && !result.exact ? result.grossAmount : null;
}

/** Pénz két tizedesen, pénznemtől függetlenül: az eltérés fillérben látszik. */
export function formatMoneyExact(value: string, currency: string): string {
  const formatted = new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
  return currency === "HUF" ? `${formatted} Ft` : `${formatted} ${currency}`;
}

/**
 * A VÁLASZTOTT TERMÉK ÁRA A SORBA (Balázs a stage-en, 2026-09-30; a szabály a
 * `billingProductPrice`-nál). A lekérés aszinkron, ezért ha a sor egységárát
 * közben kézzel kitöltötték, az nyer: a termék ára nem írja felül.
 *
 * A saját bruttó ár EGYSÉGÁR. Egy darabnál a beírt bruttó útján megy (így a
 * pontatlan visszaszámolást a sor jelzi); ha a mennyiséget közben átírták, a
 * nettó egységár ugyanebből az egy darabos számolásból jön, jelzés nélkül.
 */
export function withProductPrice(
  line: EditorLine,
  price: BillingProductPrice,
  currency: string,
): EditorLine {
  if (line.unitNet.trim() || line.grossInput !== undefined) return line;
  if (price.kind === "NONE") return { ...line, priceNote: price.reason };
  if (price.kind === "NET")
    return {
      ...line,
      unitNet: price.unitNet,
      vatRatePercent: price.vatRatePercent ?? line.vatRatePercent,
      priceNote: undefined,
    };
  const priced = withGrossInput(
    { ...line, quantity: "1", vatRatePercent: price.vatRatePercent },
    price.unitGross,
    currency,
  );
  const next: EditorLine = {
    ...priced,
    quantity: line.quantity,
    priceNote: undefined,
  };
  if (line.quantity.trim() !== "1") delete next.grossInput;
  return next;
}
