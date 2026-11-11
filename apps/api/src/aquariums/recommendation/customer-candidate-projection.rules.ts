import {
  CUSTOMER_CANDIDATE_PARAMETERS,
  CUSTOMER_CANDIDATES_PER_PARAMETER,
  type CustomerCandidatesOfMove,
} from "./customer-candidate-source.js";

/**
 * A VEVŐ FELÉ AJÁNLHATÓ TERMÉKEK VETÍTÉSÉNEK SORAI (V3.4 S2b, kártya ce6c5cc9). A tiszta rész: mit tart meg egy vetített sor. A
 * forrás (`CustomerCandidateSource.candidatesByMove`) már szűr; ez a függvény MÉG EGYSZER ellenőrzi, amit az adatbázis is (a CHECK a
 * migrációban): a vevőnek szóló sor csak jóváhagyott paraméterre és https forrás-hivatkozással mehet ki, így egy későbbi változás a
 * forrásban nem tud olyan sort a vevő felé engedni, amit a vetítés nem enged.
 *
 * Mozgásonként (paraméter és irány) legfeljebb `CUSTOMER_CANDIDATES_PER_PARAMETER` sor, a rang 1-től a megkapott sorrendben; egy
 * termék egy mozgáson belül egyszer szerepel. A bolti cím csak http(s) lehet, különben null.
 */
export interface ProjectedCandidateRow {
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  productId: string;
  productName: string;
  category: string;
  shopUrl: string | null;
  evidenceRef: string;
  rank: number;
}

const APPROVED = new Set<string>(CUSTOMER_CANDIDATE_PARAMETERS);
const HTTPS = /^https:\/\/\S+$/;
const HTTP_OR_HTTPS = /^https?:\/\/\S+$/i;

export function toProjectedCandidateRows(
  entries: readonly CustomerCandidatesOfMove[],
): ProjectedCandidateRow[] {
  const rows: ProjectedCandidateRow[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!APPROVED.has(entry.parameterCode)) continue;
    let rank = 0;
    for (const candidate of entry.candidates) {
      if (rank >= CUSTOMER_CANDIDATES_PER_PARAMETER) break;
      if (!HTTPS.test(candidate.evidenceRef)) continue;
      const key = `${entry.parameterCode}|${entry.direction}|${candidate.productId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rank += 1;
      rows.push({
        parameterCode: entry.parameterCode,
        direction: entry.direction,
        productId: candidate.productId,
        productName: candidate.name,
        category: candidate.category,
        shopUrl:
          candidate.shopUrl && HTTP_OR_HTTPS.test(candidate.shopUrl)
            ? candidate.shopUrl
            : null,
        evidenceRef: candidate.evidenceRef,
        rank,
      });
    }
  }
  return rows;
}
