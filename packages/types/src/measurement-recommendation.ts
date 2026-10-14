/**
 * A VÍZMÉRÉSI TERMÉKAJÁNLÁS (kártya 2b3983e1, Balázs 2026-10-08 21:14:24 UTC,
 * terv: `exchange/vizmeres-ajanlas/terv-2026-10-08.md`).
 *
 * A szöveg a termékre AZONOSÍTÓVAL hivatkozik: `{{termek:<id>}}`. A nevet és a
 * linket az OS rakja be a termékből, nem az AI szövegéből; ezért a szövegben
 * nincs URL, és a bolt költözésekor sem törik el. Az elemző itt áll, mert a
 * szerver (a név és a link betöltése, a jóváhagyás ellenőrzése) és a felület
 * (a szerkesztő előnézete) ugyanígy bontja.
 */

/** Egy termék-hivatkozás a szövegben. Az azonosító cuid-szerű: betű, szám, `_`, `-`. */
export const RECOMMENDATION_PRODUCT_TOKEN = /\{\{termek:([A-Za-z0-9_-]+)\}\}/g;

export type RecommendationTextPart =
  { kind: "text"; text: string } | { kind: "product"; productId: string };

/** A szöveg darabjai, sorrendben: szöveg és termék-hivatkozás. */
export function parseRecommendationText(
  text: string,
): RecommendationTextPart[] {
  const parts: RecommendationTextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(RECOMMENDATION_PRODUCT_TOKEN)) {
    const at = match.index ?? 0;
    if (at > from) parts.push({ kind: "text", text: text.slice(from, at) });
    parts.push({ kind: "product", productId: match[1]! });
    from = at + match[0].length;
  }
  if (from < text.length) parts.push({ kind: "text", text: text.slice(from) });
  return parts;
}

/**
 * HIBÁS ALAKÚ HIVATKOZÁS (barracuda, #1655): egy elgépelt alak (`{{termek: abc}}`,
 * `{{termék:abc}}`, `{{ termek:abc }}`) nem token, tehát a vevő oldalán és a
 * PDF-en nyersen, kapcsos zárójelekkel látszana. A valódi tokenek kivétele
 * után maradó `{{` vagy `}}` ezért hiba: a jóváhagyás megáll rajta.
 */
export function hasMalformedRecommendationToken(text: string): boolean {
  const rest = text.replace(RECOMMENDATION_PRODUCT_TOKEN, "");
  return rest.includes("{{") || rest.includes("}}");
}

/** A szövegben hivatkozott termékek, egyszer, az első előfordulás sorrendjében. */
export function recommendationProductIds(text: string): string[] {
  return [
    ...new Set(
      parseRecommendationText(text).flatMap((part) =>
        part.kind === "product" ? [part.productId] : [],
      ),
    ),
  ];
}

/*
  A SZÖVEG TAGOLÁSA (Balázs, 2026-10-14 08:48 UTC: „az ajánlás így nem szép …
  Vélemény - Javaslat - Ajánlott termékek”). A szöveg sima szöveg marad (a
  kolléga így szerkeszti, és a régi jóváhagyott szövegek is ilyenek), a felület
  és a PDF ebből rajzol:
    - fejléc: egy sor, ami csak a három cím egyike, kettősponttal vagy anélkül
      (a markdown `**` és `#` jelölése nélkül is felismerve); egy „Vélemény: …”
      alakú sorban a cím után álló szöveg az első bekezdés;
    - lista: `- ` vagy `• ` kezdetű sor; az egymás utániak egy listát adnak;
    - bekezdés: a többi; üres sor választja el, a sima sortörés megmarad.
  A darabok (szöveg és termék) a soron belül változatlanok: a termék-hivatkozás
  ugyanúgy a termékből kap nevet és linket.
*/
export const RECOMMENDATION_HEADINGS = [
  "Vélemény",
  "Javaslat",
  "Ajánlott termékek",
] as const;
export type RecommendationHeading = (typeof RECOMMENDATION_HEADINGS)[number];

export type RecommendationBlock<T> =
  | { kind: "heading"; text: RecommendationHeading }
  /** sorok, soronként a darabjaik */
  | { kind: "paragraph"; lines: T[][] }
  /** tételek, tételenként a darabjaik */
  | { kind: "list"; items: T[][] };

const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const LIST_MARKER = /^\s*[-•]\s+/;

/**
 * A sor eleje cím-e. Cím: a sor csak a cím (kettősponttal vagy anélkül), vagy
 * a cím, kettőspont, és utána szöveg. Egy „Javaslatunk szerint …” mondat nem cím.
 */
function headingOf(
  text: string,
): { heading: RecommendationHeading; rest: string; colon: boolean } | null {
  const cleaned = text
    .normalize("NFC")
    .replace(/\*\*/g, "")
    .replace(/^\s*#+\s*/, "")
    .trim();
  for (const heading of RECOMMENDATION_HEADINGS) {
    if (fold(cleaned.slice(0, heading.length)) !== fold(heading)) continue;
    const after = cleaned.slice(heading.length);
    if (!after.trim()) return { heading, rest: "", colon: false };
    const match = /^\s*:\s*([\s\S]*)$/.exec(after);
    if (match) return { heading, rest: match[1]!.trim(), colon: true };
  }
  return null;
}

/** A darabok tagolva: fejléc, bekezdés, lista (lásd fent). */
export function recommendationBlocks<T extends { kind: string }>(
  segments: readonly T[],
): RecommendationBlock<T>[] {
  // 1. sorokra bontás: a szöveg-darab a sortöréseknél szétválik
  const lines: T[][] = [[]];
  for (const segment of segments) {
    if (segment.kind !== "text") {
      lines.at(-1)!.push(segment);
      continue;
    }
    const pieces = (segment as unknown as { text: string }).text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines.at(-1)!.push({ ...segment, text: piece });
    });
  }
  // 2. soronként: üres, fejléc, listatétel vagy bekezdés-sor
  const blocks: RecommendationBlock<T>[] = [];
  const textOf = (line: T[]) =>
    line.every((part) => part.kind === "text")
      ? line.map((part) => (part as unknown as { text: string }).text).join("")
      : null;
  const paragraphLine = (line: T[]) => {
    const last = blocks.at(-1);
    if (last?.kind === "paragraph") last.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
  };
  let broken = true; // egy üres sor után új bekezdés indul
  for (const line of lines) {
    const whole = textOf(line);
    if (whole !== null && !whole.trim()) {
      broken = true;
      continue;
    }
    const first = line[0];
    const firstText =
      first?.kind === "text"
        ? (first as unknown as { text: string }).text
        : null;
    const heading = firstText !== null ? headingOf(firstText) : null;
    if (heading && (heading.colon || line.length === 1)) {
      blocks.push({ kind: "heading", text: heading.heading });
      const rest = heading.rest
        ? [{ ...first!, text: heading.rest } as T, ...line.slice(1)]
        : line.slice(1);
      if (rest.length) blocks.push({ kind: "paragraph", lines: [rest] });
      broken = false;
      continue;
    }
    if (firstText !== null && LIST_MARKER.test(firstText)) {
      const stripped = firstText.replace(LIST_MARKER, "");
      const item = [
        ...(stripped ? [{ ...first!, text: stripped } as T] : []),
        ...line.slice(1),
      ];
      const last = blocks.at(-1);
      if (last?.kind === "list" && !broken) last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      broken = false;
      continue;
    }
    if (broken || blocks.at(-1)?.kind !== "paragraph")
      blocks.push({ kind: "paragraph", lines: [line] });
    else paragraphLine(line);
    broken = false;
  }
  return blocks;
}

/** Egy darab, ahogy a felület rajzolja: a termék nevével és linkjével. */
export type MeasurementRecommendationSegment =
  | { kind: "text"; text: string }
  | {
      kind: "product";
      productId: string;
      /** `null`: a jelöltlistán kívüli azonosító (a belső felületen hiba). */
      name: string | null;
      /** A termék webshop-lapja; `null`, ha nincs publikált lapja. */
      url: string | null;
    };

export type MeasurementRecommendationStatus = "DRAFT" | "APPROVED";

/** Honnan jött egy jelölt (nautilus 28462): a kategóriából vagy a JEV-ből. */
export type RecommendationCandidateBasis = "CATEGORY" | "JEV";

export interface MeasurementRecommendationCandidate {
  productId: string;
  name: string;
  category: string;
  /** A mozgatott paraméterek; üres, ha nincs mögötte gyártói állítás. */
  effects: { parameterCode: string; direction: "EMEL" | "CSOKKENT" }[];
  basis: RecommendationCandidateBasis;
  /** JEV-nél a forrásoldal címe. */
  evidenceRef?: string;
  /**
   * JEV-nél `true`, ha a hatást csak a SAJÁT adatunk állítja (a JEV
   * `UNVERIFIED` eredménye: kategória-szabály vagy a saját termékadat), és
   * független forrás (gyártó, beszállító) nem erősíti meg. A jóváhagyó ezt
   * látja (Balázs, 2026-10-12 12:42 UTC). Hiányzó: megerősített, vagy nem JEV.
   */
  unverified?: boolean;
}

/** A belső felület nézete: a vázlat, a jóváhagyott szöveg és a jelöltek. */
export interface MeasurementRecommendationView {
  id: string;
  occasionId: string;
  status: MeasurementRecommendationStatus;
  aiDraft: string | null;
  aiModel: string | null;
  aiRequestedAt: string | null;
  draftText: string | null;
  draftSegments: MeasurementRecommendationSegment[];
  /** A vázlat jelöltlistán kívüli azonosítói: amíg van, nem hagyható jóvá. */
  unknownProductIds: string[];
  /**
   * A vázlatban hivatkozott, csak saját adattal alátámasztott jelöltek
   * (`unverified`). Nem tiltja a jóváhagyást, de a jóváhagyó előtte látja.
   */
  unverifiedProductIds: string[];
  /** A vázlatban hibás alakú hivatkozás áll (`{{`/`}}` marad): nem hagyható jóvá. */
  malformedReference: boolean;
  approvedText: string | null;
  approvedSegments: MeasurementRecommendationSegment[];
  approvedAt: string | null;
  approvedByName: string | null;
  candidates: MeasurementRecommendationCandidate[];
  updatedAt: string;
}

export interface UpdateMeasurementRecommendationInput {
  text: string;
  expectedUpdatedAt: string;
}

export interface ApproveMeasurementRecommendationInput {
  expectedUpdatedAt: string;
}
