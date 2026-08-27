import type { WorksheetDepartmentSummary } from "@acropora/types";

/**
 * A HELYSZINEK FAJA, LAPOSAN, MEGJELENITESI SORRENDBEN.
 *
 * A szerver laposan adja vissza a sorokat, a `parentId` mezovel. A felepites
 * itt tortenik, es nem a szerveren, mert egy uj szint igy nem valtoztat
 * vegpontot -- a lista ugyanaz marad, csak melyebb.
 */
export interface SiteTreeRow {
  unit: WorksheetDepartmentSummary;
  /** Hany szintre van a gyokertol. A gyoker 0. */
  depth: number;
}

/**
 * Melysegi bejaras, szinten belul kod szerint.
 *
 * AMI NEM VESZHET EL: az a sor, aminek a szuloje HIANYZIK a listabol. Ez ma
 * nem fordulhat elo (egy partner osszes helyszine egyszerre jon), de ha
 * megis -- szures, jogosultsag, felig betoltott valasz --, akkor az a sor
 * NEM tunhet el a kepernyorol csendben. Az ilyet a fa VEGERE tesszuk, gyoker
 * szintre: inkabb alljon rossz helyen, mint hogy ne latszon.
 */
export function buildSiteTree(
  units: readonly WorksheetDepartmentSummary[],
): SiteTreeRow[] {
  const byParent = new Map<string | null, WorksheetDepartmentSummary[]>();
  const known = new Set(units.map((unit) => unit.id));

  for (const unit of units) {
    const parent =
      unit.parentId && known.has(unit.parentId) ? unit.parentId : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(unit);
    else byParent.set(parent, [unit]);
  }

  for (const siblings of byParent.values())
    siblings.sort((left, right) => left.code.localeCompare(right.code, "hu"));

  const rows: SiteTreeRow[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number): void => {
    for (const unit of byParent.get(parentId) ?? []) {
      // Kor eseten megallunk: egy hibas adat ne fagyassza le a kepernyot.
      if (visited.has(unit.id)) continue;
      visited.add(unit.id);
      rows.push({ unit, depth });
      walk(unit.id, depth + 1);
    }
  };

  walk(null, 0);

  // Ami kimaradt (kor miatt), a vegere kerul, hogy latszodjon.
  for (const unit of units)
    if (!visited.has(unit.id)) rows.push({ unit, depth: 0 });

  return rows;
}

/**
 * A teljes kod, ahogy az emberek mondjak: `BIO-FNM`.
 *
 * A partner rovidítese NINCS benne: az a partner adatlapjan all, es a
 * munkalapszam alakjarol szolo dontes meg nyitott. Ez a fuggveny csak a
 * helyszin utjat adja, es nem allit semmit a bizonylatszamrol.
 */
export function siteCodePath(
  rows: readonly SiteTreeRow[],
  unitId: string,
): string {
  const index = rows.findIndex((row) => row.unit.id === unitId);
  if (index < 0) return "";

  const path = [rows[index]!.unit.code];
  let depth = rows[index]!.depth;
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    if (rows[cursor]!.depth === depth - 1) {
      path.unshift(rows[cursor]!.unit.code);
      depth -= 1;
    }
  }
  return path.join("-");
}
