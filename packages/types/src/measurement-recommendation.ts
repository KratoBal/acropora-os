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
