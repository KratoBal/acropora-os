import { CUSTOMER_CANDIDATE_PARAMETERS } from "./customer-candidate-source.js";

/**
 * A KÉZI LISTA SORAI A VEVŐI JELÖLTEKBEN (V3.4 S2c-2, kártya ce6c5cc9). A tiszta rész: a kézi tábla (`CustomerCandidateManualEntry`, S2c-1)
 * soraiból, egy kívánt mozgásra, mely termékek lehetnek jelöltek, és mit tudunk róluk.
 *
 *  1. CSAK a TELJES termék: ha a termék BÁRMELY kézi sora `PENDING` (a mellékhatás-listája még nincs kitöltve), a termék EGÉSZE kimarad.
 *     Egy termék mellékhatása termék-szintű tény, és egy félig kitöltött lista elhallgatna egy hatást (barracuda: a jelölt a hatását
 *     nem hallgathatja el; acrobot 47162: csak FILLED megy).
 *  2. A HATÁSOK (`effects`) a termék MINDEN kézi sorából jönnek, bármilyen alappal: egy KH-t emelő, de kalciumot is emelő termék a kalcium
 *     ellen álló vevőnek akkor sem megy, ha a kalcium-sorának alapja (SHOP_TEXT) a vevő felé még nem engedett (barracuda, #2420: az
 *     ellentétes-hatás szűrő a termék ÖSSZES mozgását lássa). A hatás ismerete nem ajánlás.
 *  3. A MELLÉKHATÁSOK a termék minden sorának `sideEffects` listájának egyesítése.
 *  4. AJÁNLÁS egy mozgásra csak olyan sorból megy, amelynek alapja engedett: `MAKER` mindig, `SHOP_TEXT` csak a kapcsolóval (a kapcsoló a
 *     teszt ReefClubon van be; alapból ki), és a hivatkozás https (a tábla CHECK-je és ez a második zár).
 *  5. Ha több sor ajánlja ugyanazt a mozgást (nem fordul elő: a tábla a termék és mozgás párra egyedi), a MAKER előz.
 *
 * Az eredmény a JEV-jelöltek alakjával egyezik, plusz `referenceKind`: a hivatkozás fajtája, amiből a felület a címkét választja.
 */
export type ReferenceKind = "MAKER" | "SHOP_TEXT";
type Direction = "EMEL" | "CSOKKENT";
interface Effect {
  parameterCode: string;
  direction: Direction;
}

export interface ManualEntryInput {
  productId: string;
  parameterCode: string;
  direction: Direction;
  referenceUrl: string;
  basis: ReferenceKind;
  sideEffects: readonly string[];
  sideEffectsStatus: "FILLED" | "PENDING";
}

export interface CandidateMatch {
  productId: string;
  effects: Effect[];
  sideEffects: Effect[];
  evidenceRef: string;
  referenceKind: ReferenceKind;
}

// built on first use: the source module imports this one, so a module-level read of its constant would run before it is initialised
let approvedSet: ReadonlySet<string> | null = null;
const isApproved = (code: string): boolean => {
  approvedSet ??= new Set<string>(CUSTOMER_CANDIDATE_PARAMETERS);
  return approvedSet.has(code);
};
const HTTPS = /^https:\/\/[^\s]+$/;

const effectKey = (effect: Effect) =>
  `${effect.parameterCode}:${effect.direction}`;

function parseEffect(text: string): Effect | null {
  const [parameterCode, direction, rest] = text.split(":");
  if (!parameterCode || rest !== undefined) return null;
  if (direction !== "EMEL" && direction !== "CSOKKENT") return null;
  return { parameterCode, direction };
}

export function uniqueEffects(effects: readonly Effect[]): Effect[] {
  const seen = new Map<string, Effect>();
  for (const effect of effects) seen.set(effectKey(effect), effect);
  return [...seen.values()].sort((a, b) =>
    effectKey(a).localeCompare(effectKey(b)),
  );
}

/** A hatás egy MÁSIK kívánt mozgás ellen megy: ugyanazt a paramétert az ellenkező irányba viszi. */
export function harmsWanted(
  effects: readonly Effect[],
  wanted: ReadonlyMap<string, Direction>,
): boolean {
  return effects.some((effect) => {
    const want = wanted.get(effect.parameterCode);
    return want !== undefined && want !== effect.direction;
  });
}

export function manualMatches(
  entries: readonly ManualEntryInput[],
  wanted: ReadonlyMap<string, Direction>,
  options: { allowShopText: boolean },
): CandidateMatch[] {
  const byProduct = new Map<string, ManualEntryInput[]>();
  for (const entry of entries) {
    const list = byProduct.get(entry.productId) ?? [];
    list.push(entry);
    byProduct.set(entry.productId, list);
  }
  const matches: CandidateMatch[] = [];
  for (const [productId, rows] of byProduct) {
    if (rows.some((row) => row.sideEffectsStatus !== "FILLED")) continue;
    const effects = uniqueEffects(
      rows
        .filter((row) => isApproved(row.parameterCode))
        .map((row) => ({
          parameterCode: row.parameterCode,
          direction: row.direction,
        })),
    );
    if (harmsWanted(effects, wanted)) continue;
    const sideEffects = uniqueEffects(
      rows.flatMap((row) =>
        row.sideEffects.flatMap((text) => {
          const parsed = parseEffect(text);
          return parsed && !isApproved(parsed.parameterCode) ? [parsed] : [];
        }),
      ),
    );
    const offering = rows
      .filter(
        (row) =>
          wanted.get(row.parameterCode) === row.direction &&
          isApproved(row.parameterCode) &&
          HTTPS.test(row.referenceUrl) &&
          (row.basis === "MAKER" ||
            (row.basis === "SHOP_TEXT" && options.allowShopText)),
      )
      .sort(
        (a, b) =>
          Number(b.basis === "MAKER") - Number(a.basis === "MAKER") ||
          a.referenceUrl.localeCompare(b.referenceUrl),
      );
    const pick = offering[0];
    if (!pick) continue;
    matches.push({
      productId,
      effects,
      sideEffects,
      evidenceRef: pick.referenceUrl,
      referenceKind: pick.basis,
    });
  }
  return matches;
}

/**
 * A JEV-JELÖLTEK ÉS A KÉZI JELÖLTEK EGYESÍTÉSE termékenként. Ugyanaz a termék mindkét úton: a hatások és a mellékhatások egyesülnek, a
 * hivatkozás a JEV-é (gyártói, VERIFIED). Csak kézi termék: a hatásai kiegészülnek a JEV VERIFIED hatásaival (`verifiedByProduct`: a
 * termék minden VERIFIED hatása, a kívánt mozgástól függetlenül), hogy az ellentétes-hatás szűrő a JEV-ben ismert hatást se hagyja ki.
 * Az egyesítés után az ellentétes-hatás szűrés újra fut: a másik út hatása egy jelöltet kiejthet.
 */
export function mergeCandidateMatches<
  J extends {
    productId: string;
    effects: Effect[];
    sideEffects: Effect[];
    evidenceRef: string;
  },
>(
  jev: readonly J[],
  manual: readonly CandidateMatch[],
  verifiedByProduct: ReadonlyMap<
    string,
    { effects: Effect[]; sideEffects: Effect[] }
  >,
  wanted: ReadonlyMap<string, Direction>,
): (Omit<J, never> & { referenceKind: ReferenceKind })[] {
  const out = new Map<
    string,
    Omit<J, never> & { referenceKind: ReferenceKind }
  >();
  const manualById = new Map(manual.map((match) => [match.productId, match]));
  for (const match of jev) {
    const extra = manualById.get(match.productId);
    out.set(match.productId, {
      ...match,
      effects: uniqueEffects([...match.effects, ...(extra?.effects ?? [])]),
      sideEffects: uniqueEffects([
        ...match.sideEffects,
        ...(extra?.sideEffects ?? []),
      ]),
      referenceKind: "MAKER",
    });
  }
  for (const match of manual) {
    if (out.has(match.productId)) continue;
    const known = verifiedByProduct.get(match.productId);
    out.set(match.productId, {
      productId: match.productId,
      effects: uniqueEffects([...match.effects, ...(known?.effects ?? [])]),
      sideEffects: uniqueEffects([
        ...match.sideEffects,
        ...(known?.sideEffects ?? []),
      ]),
      evidenceRef: match.evidenceRef,
      referenceKind: match.referenceKind,
    } as Omit<J, never> & { referenceKind: ReferenceKind });
  }
  return [...out.values()].filter(
    (match) => !harmsWanted(match.effects, wanted),
  );
}
