/**
 * A PARTNER HELYSZÍNEI VÁLASZTÓ-LISTÁVÁ, TELJES ÚTTAL.
 *
 * A szerver laposan adja vissza az alegységeket (`parentId` mezővel), mert egy
 * partner helyszínei elférnek egy kötegben, és így egy új szint nem változtat
 * végpontot. A fát a hívó építi fel -- a telefonon ez az a modul.
 *
 * AMIÉRT AZ ÚT KELL, ÉS NEM ELÉG A NÉV: a kód és a név csak TESTVÉREK között
 * egyedi (`@@unique([customerId, parentId, code])`), tehát két távoli ág alatt
 * ugyanaz a „Biodóm (BIO)" megengedett és természetes. Aki egy listában a puszta
 * nevet látja, nem tudja megmondani, melyikről van szó, és semmi nem jelzi neki,
 * hogy van miben tévedni. Ugyanez a szabály áll a weben
 * (`apps/web/src/lib/partners/site-tree.ts`) és a szerveren
 * (`AssetUnitSummary.path`) is.
 *
 * SAJÁT MÁSOLAT, mert az Expo app nem húzza be a munkatér csomagjait. A
 * viselkedés azonossága nem feltételezés: a spec ugyanazokat az eseteket méri,
 * és a két fájl egymásra hivatkozik.
 */

export interface PartnerUnitLike {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export interface UnitOption {
  id: string;
  /** A TELJES ÚT, a végén a kóddal: `Fánk / Biodóm (BIO)`. */
  label: string;
  isActive: boolean;
}

/**
 * A fa bejárása, gyökértől lefelé, testvérek között kód szerint.
 *
 * KÉT VÉDELEM, ÉS EGYIK SEM ELMÉLETI. A hiányzó szülő (szűrt vagy félig
 * betöltött válasz) és a kör (hibás adat) is némán végtelen ciklust adna, vagy
 * eltüntetne sorokat: aki a listát nézi, egy rövidebb listát látna, és semmi nem
 * mondaná meg, hogy hiányzik belőle valami. Ezért ami a bejárásból kimaradt, a
 * lista VÉGÉRE kerül, nem vész el.
 */
function ordered(units: readonly PartnerUnitLike[]): PartnerUnitLike[] {
  const byParent = new Map<string | null, PartnerUnitLike[]>();
  for (const unit of units) {
    const siblings = byParent.get(unit.parentId) ?? [];
    siblings.push(unit);
    byParent.set(unit.parentId, siblings);
  }
  for (const siblings of byParent.values())
    siblings.sort((left, right) => left.code.localeCompare(right.code, "hu"));

  const rows: PartnerUnitLike[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const unit of byParent.get(parentId) ?? []) {
      if (visited.has(unit.id)) continue;
      visited.add(unit.id);
      rows.push(unit);
      walk(unit.id);
    }
  };
  walk(null);

  for (const unit of units) if (!visited.has(unit.id)) rows.push(unit);
  return rows;
}

export function buildUnitOptions(
  units: readonly PartnerUnitLike[],
): UnitOption[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));

  const pathOf = (unit: PartnerUnitLike): string[] => {
    const names = [unit.name];
    const seen = new Set([unit.id]);
    let current = unit.parentId ? byId.get(unit.parentId) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names;
  };

  return ordered(units).map((unit) => ({
    id: unit.id,
    label: `${pathOf(unit).join(" / ")} (${unit.code})`,
    isActive: unit.isActive,
  }));
}

export interface SelectableUnits {
  options: UnitOption[];
  /** Hány helyszín maradt ki, mert kivezették. */
  hiddenCount: number;
}

/**
 * AMIT ÚJ ESZKÖZHÖZ VÁLASZTANI LEHET, ÉS AMI KIMARADT.
 *
 * A kivezetett (nem aktív) helyszínt a SZERVER elutasítja (`INACTIVE`), tehát
 * felkínálni csapda: a szerelő kiválasztja, kitölti az űrlapot, megnyomja a
 * mentést, és a végén kap egy elutasítást arról, amit a lista maga ajánlott.
 *
 * A kihagyás viszont NEM lehet néma. Aki tudja, hogy annak a partnernek hat
 * helyszíne van, és négyet lát, azt fogja hinni, hogy a lista hibás -- vagy
 * ami rosszabb, rossz helyszínt választ a maradékból. Ezért a darabszám is
 * visszajön, és a képernyő kiírja.
 */
export function selectableUnitOptions(
  units: readonly PartnerUnitLike[],
): SelectableUnits {
  const options = buildUnitOptions(units);
  const active = options.filter((option) => option.isActive);
  return { options: active, hiddenCount: options.length - active.length };
}

/**
 * A KIVÁLASZTOTT HELYSZÍN NEVE, ahogy az eszközön látszik.
 *
 * A szerver az eszközzel együtt az egész utat adja (`unit.path`), tehát itt nincs
 * mit felépíteni: csak összefűzni. Ha az út valamiért üres, a név a visszaesés --
 * kevesebb, de igaz.
 */
export function unitPathLabel(unit: {
  name: string;
  path?: readonly string[];
}): string {
  const path = unit.path?.filter((part) => part.trim()) ?? [];
  return path.length > 0 ? path.join(" / ") : unit.name;
}
