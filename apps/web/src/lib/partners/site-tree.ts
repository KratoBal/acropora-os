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

export interface SiteOption {
  id: string;
  /** A TELJES ÚT, nem csak a levél neve. */
  label: string;
  isActive: boolean;
}

/**
 * A FA VÁLASZTÓ-LISTÁVÁ, TELJES ÚTTAL.
 *
 * AMIÉRT AZ ÚT KELL, ÉS NEM ELÉG A BEHÚZÁS: a kód és a név csak TESTVÉREK
 * között egyedi. Két távoli ág alatt ugyanaz a `BIO` és ugyanaz a „Biodóm"
 * megengedett és természetes. Egy lapos `<select>`-ben a behúzás ezt nem oldja
 * meg: a szóközök összeolvadhatnak, és két azonos nevű sor megkülönböztethetetlen
 * lenne. Az út viszont a fa szabálya szerint egyedi.
 *
 * A kód a végén áll, zárójelben: az a munkalapszám első tagja, tehát azt keresi
 * az, aki egy számot lát maga előtt.
 */
export function buildSiteOptions(
  units: readonly WorksheetDepartmentSummary[],
): SiteOption[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));

  const pathOf = (unit: WorksheetDepartmentSummary): string[] => {
    const names: string[] = [unit.name];
    const seen = new Set<string>([unit.id]);
    let current = unit.parentId ? byId.get(unit.parentId) : undefined;
    // A hianyzo szulo (szures, felig betoltott valasz) es a kor is megall:
    // inkabb rovidebb ut, mint vegtelen ciklus vagy eltunt sor.
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names;
  };

  return buildSiteTree(units).map(({ unit }) => ({
    id: unit.id,
    label: `${pathOf(unit).join(" / ")} (${unit.code})`,
    isActive: unit.isActive,
  }));
}
