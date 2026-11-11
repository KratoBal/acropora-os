import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  isRecommendableOnUnas,
  latestJevEffectRows,
  matchingJevRows,
  type JevEffectRow,
} from "./jev-candidate-source.js";

/**
 * A VEVŐI JELÖLT-FORRÁS (kártya ce6c5cc9, V3.4 S2; Balázs 2026-11-11 11:44:46 UTC, msg 1570041598300004414: (d) a vevő felé csak
 * VERIFIED termékadat, (e) paraméterenként 3-5 termék). A belső jelölt-forrás (`JevRecommendationCandidateSource`) a saját adattal
 * alátámasztott (UNVERIFIED) hatást is jelöltnek veszi, MEGJELÖLVE, mert ott egy kolléga hagyja jóvá. A vevői úton nincs kolléga, ezért
 * ez a forrás SZŰKEBB, és a szűkítés nem az AI-ra vagy a hívóra van bízva:
 *
 *  1. CSAK `VERIFIED` hatás (független forrás: gyártó, beszállító). Az `UNVERIFIED` SOHA, a saját érték sem, megjelöléssel sem; az
 *     eredmény ezért nem is hordozza az `unverified` jelzőt.
 *  2. a gyártói forrás HIVATKOZÁSA kell és https: termékenként a hivatkozás megy a vevőnek (a gyártó adagolási lapja), NEM adagolási
 *     mondat. Hivatkozás nélküli vagy nem https hatás nem jelölt: a vevő nem kapna forrást, amire támaszkodhat.
 *  3. aktív és vásárolható termék, a belső szabályokkal azonosan (`isRecommendableOnUnas`).
 *  4. csak a négy VEVŐ FELÉ JÓVÁHAGYOTT paraméter (KH, kalcium, magnézium, nitrát): a foszfát nem kerülhet ide, akkor sem, ha a hívó
 *     foszfát-eltérést ad át (az S1 nyilvántartás foszfát-sávja nem jóváhagyott). Az S3 a kívánt mozgásokat az S1 jóváhagyott sávjából
 *     képezi; ez a lista a második zár.
 *  5. paraméterenként legfeljebb `CUSTOMER_CANDIDATES_PER_PARAMETER`, előre az, amelyik több kívánt eltérést javít, utána név szerint.
 *
 * Eredmény nélkül (nincs VERIFIED termék) üres lista: az üres lista NEM ajánlás. Mérve 2026-11-10 (a belső mérésben): 100 termékből 0
 * VERIFIED és 36 UNVERIFIED volt, tehát a forrás a mai adattal valószínűleg üres marad, amíg a JEV-ellenőrzés nem bővül (a kártya
 * (d) pontja: indulás előtt az érintett termékeket ellenőrizni kell).
 */
export const CUSTOMER_CANDIDATE_PARAMETERS = [
  "KH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
] as const;

/** Paraméterenként ennyi termék mehet a vevőnek (a döntés (e) pontja: 3-5; a felső határ). */
export const CUSTOMER_CANDIDATES_PER_PARAMETER = 5;

export interface CustomerWantedMove {
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
}

export interface CustomerRecommendationCandidate {
  productId: string;
  name: string;
  category: string;
  /** A mozgatott paraméterek (csak a vevő felé jóváhagyottak). */
  effects: { parameterCode: string; direction: "EMEL" | "CSOKKENT" }[];
  /** A gyártói forrás (https) hivatkozása: ez megy a vevőnek, nem egy adagolási mondat. */
  evidenceRef: string;
}

const APPROVED = new Set<string>(CUSTOMER_CANDIDATE_PARAMETERS);

/** A kívánt mozgásokból csak a vevő felé jóváhagyott paraméterek maradnak. */
export function customerWantedMoves(
  moves: readonly CustomerWantedMove[],
): Map<string, "EMEL" | "CSOKKENT"> {
  return new Map(
    moves
      .filter((move) => APPROVED.has(move.parameterCode))
      .map((move) => [move.parameterCode, move.direction] as const),
  );
}

const HTTPS_REFERENCE = /^https:\/\/[^\s]+$/;

/** A JEV-sorokból azok, amelyek a jó irányba mozgatnak valamit, VERIFIED hatással és https forrás-hivatkozással. */
export function customerMatchingRows(
  rows: readonly JevEffectRow[],
  wanted: ReadonlyMap<string, "EMEL" | "CSOKKENT">,
): {
  productId: string;
  effects: CustomerRecommendationCandidate["effects"];
  evidenceRef: string;
}[] {
  const verified = rows.filter(
    (row) => row.status === "VERIFIED" && Boolean(row.value),
  );
  return matchingJevRows(verified, wanted).flatMap((match) => {
    if (!match.evidenceRef || !HTTPS_REFERENCE.test(match.evidenceRef))
      return [];
    return [
      {
        productId: match.productId,
        // csak a vevő felé jóváhagyott paraméterek hatása megy tovább
        effects: match.effects.filter((effect) =>
          APPROVED.has(effect.parameterCode),
        ),
        evidenceRef: match.evidenceRef,
      },
    ];
  });
}

/**
 * Paraméterenként legfeljebb `perParameter` termék: egy paraméter jelöltjei közül előre az, amelyik több KÍVÁNT eltérést javít, aztán
 * név szerint. A végeredmény az egyesítés, termékenként egyszer, a név szerinti sorrendben.
 */
export function limitCustomerCandidates(
  candidates: readonly CustomerRecommendationCandidate[],
  wanted: ReadonlyMap<string, "EMEL" | "CSOKKENT">,
  perParameter: number = CUSTOMER_CANDIDATES_PER_PARAMETER,
): CustomerRecommendationCandidate[] {
  const helped = (candidate: CustomerRecommendationCandidate) =>
    candidate.effects.filter(
      (effect) => wanted.get(effect.parameterCode) === effect.direction,
    ).length;
  const order = (
    a: CustomerRecommendationCandidate,
    b: CustomerRecommendationCandidate,
  ) => helped(b) - helped(a) || a.name.localeCompare(b.name, "hu");
  const kept = new Map<string, CustomerRecommendationCandidate>();
  for (const [parameter, direction] of wanted) {
    const forParameter = candidates
      .filter((candidate) =>
        candidate.effects.some(
          (effect) =>
            effect.parameterCode === parameter &&
            effect.direction === direction,
        ),
      )
      .sort(order)
      .slice(0, Math.max(0, perParameter));
    for (const candidate of forParameter)
      kept.set(candidate.productId, candidate);
  }
  return [...kept.values()].sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

@Injectable()
export class CustomerCandidateSource {
  private readonly database = prisma;

  /** A kívánt mozgásokhoz a vevő felé használható jelöltek; kívánt mozgás nélkül (vagy csak nem jóváhagyott paraméterrel) nincs lekérdezés. */
  async candidates(input: {
    moves: readonly CustomerWantedMove[];
  }): Promise<CustomerRecommendationCandidate[]> {
    const wanted = customerWantedMoves(input.moves);
    if (wanted.size === 0) return [];
    const rows = await latestJevEffectRows(this.database);
    const matches = customerMatchingRows(rows, wanted);
    if (matches.length === 0) return [];
    const products = await this.database.product.findMany({
      where: {
        id: { in: matches.map((match) => match.productId) },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        categories: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          take: 1,
          select: { category: { select: { name: true } } },
        },
        channelListings: { select: { channel: true, externalStatus: true } },
        unasSnapshot: { select: { rawPayload: true } },
      },
    });
    const byId = new Map(
      products
        .filter((product) => isRecommendableOnUnas(product))
        .map((product) => [product.id, product]),
    );
    return limitCustomerCandidates(
      matches.flatMap((match) => {
        const product = byId.get(match.productId);
        if (!product) return [];
        return [
          {
            productId: product.id,
            name: product.name,
            category: product.categories[0]?.category.name ?? "",
            effects: match.effects,
            evidenceRef: match.evidenceRef,
          },
        ];
      }),
      wanted,
    );
  }
}
