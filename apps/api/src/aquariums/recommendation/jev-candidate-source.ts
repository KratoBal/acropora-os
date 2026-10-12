import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { parseWaterParameterEffects } from "@acropora/jev/product-enrichment";
import type { MeasurementRecommendationCandidate } from "@acropora/types";

import type {
  RecommendationCandidateSource,
  RecommendationDeviation,
} from "./measurement-recommendation.contract.js";

/**
 * A JELÖLTEK A JEV-BŐL (kártya 2b3983e1, a 2026-10-08-as jóváhagyott terv 4.
 * lépése; Balázs: „Szerintem a Jev-et elesitsuk erre a feladtara”). Jelölt az
 * az aktív termék, amelynek a JEV szerint ELLENŐRZÖTT (`VERIFIED`)
 * `waterParameterEffects` értéke a mért eltérés paraméterét a JÓ IRÁNYBA
 * mozgatja: alacsony értéknél emeli, magasnál csökkenti.
 *
 * Termékenként a LEGUTÓBBI JEV-eredmény számít (a sikeres futásokból), ahogy a
 * termékminőség sora is nézi: egy régebbi ellenőrzött érték nem éled fel, ha a
 * legutóbbi futás már ütközést vagy mást mondott.
 *
 * Ami NEM számít: az ellenőrizetlen vagy ütköző érték (az AI csak forrással
 * igazolt állításra hivatkozhat), az inaktív termék, és a termék törzsadata
 * (ebből nem írunk és nem olvasunk hatást).
 */
export interface JevEffectRow {
  productId: string;
  status: string;
  value: string | null;
  sourceRef: string | null;
}

/** A mért eltérésből a kívánt mozgás: alacsony -> emel, magas -> csökkent. */
export function wantedMoves(
  deviations: readonly Pick<
    RecommendationDeviation,
    "parameterCode" | "direction"
  >[],
): Map<string, "EMEL" | "CSOKKENT"> {
  return new Map(
    deviations.map((d) => [
      d.parameterCode,
      d.direction === "LOW" ? ("EMEL" as const) : ("CSOKKENT" as const),
    ]),
  );
}

/** A JEV-sorokból azok, amelyek ellenőrzötten a jó irányba mozgatnak valamit. */
export function matchingJevRows(
  rows: readonly JevEffectRow[],
  wanted: ReadonlyMap<string, "EMEL" | "CSOKKENT">,
): {
  productId: string;
  effects: MeasurementRecommendationCandidate["effects"];
  evidenceRef?: string;
}[] {
  return rows.flatMap((row) => {
    if (row.status !== "VERIFIED" || !row.value) return [];
    const parsed = parseWaterParameterEffects(row.value);
    if (!parsed.ok) return [];
    const helps = parsed.effects.some(
      (effect) => wanted.get(effect.code) === effect.direction,
    );
    if (!helps) return [];
    return [
      {
        productId: row.productId,
        effects: parsed.effects.map((effect) => ({
          parameterCode: effect.code,
          direction: effect.direction,
        })),
        ...(row.sourceRef ? { evidenceRef: row.sourceRef } : {}),
      },
    ];
  });
}

@Injectable()
export class JevRecommendationCandidateSource implements RecommendationCandidateSource {
  private readonly database = prisma;

  async candidates(input: {
    deviations: readonly RecommendationDeviation[];
  }): Promise<MeasurementRecommendationCandidate[]> {
    const wanted = wantedMoves(input.deviations);
    if (wanted.size === 0) return [];
    const rows = await this.database.$queryRaw<JevEffectRow[]>`
      SELECT DISTINCT ON (c."productId") c."productId", f.status, f.value, f."sourceRef"
      FROM "ProductEnrichmentFieldResult" f
      JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
      JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
      WHERE f.field = 'waterParameterEffects'
        AND r.status IN ('COMPLETED', 'LIMIT_REACHED')
      ORDER BY c."productId", c."checkedAt" DESC, f.id DESC`;
    const matches = matchingJevRows(rows, wanted);
    if (matches.length === 0) return [];
    const products = await this.database.product.findMany({
      where: { id: { in: matches.map((m) => m.productId) }, isActive: true },
      select: {
        id: true,
        name: true,
        categories: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          take: 1,
          select: { category: { select: { name: true } } },
        },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return matches.flatMap((match) => {
      const product = byId.get(match.productId);
      if (!product) return [];
      return [
        {
          productId: product.id,
          name: product.name,
          category: product.categories[0]?.category.name ?? "",
          effects: match.effects,
          basis: "JEV" as const,
          ...(match.evidenceRef ? { evidenceRef: match.evidenceRef } : {}),
        },
      ];
    });
  }
}
