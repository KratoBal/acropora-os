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

/**
 * A HELYSZÍN LÉPCSŐS VÁLASZTÓJA: EGY SZINT EGY SOR.
 *
 * A teljes utas lista (`selectableUnitOptions`) egy dolgot old meg jól: két
 * azonos nevű helyszín megkülönböztetését. Amit NEM old meg, az a telefon
 * képernyője: egy háromszintű partnernél minden sor a teljes utat viszi, a
 * lista hosszú, és a választás közben nem látszik, hol tart az ember.
 *
 * A lépcsős alak ugyanabból az adatból dolgozik, csak SZINTENKÉNT: először a
 * gyökerek, a választás után annak a gyerekei, és így tovább. Ami a képernyőn
 * marad, az minden szinten néhány testvér, nem a teljes fa.
 *
 * A VISSZAADOTT LÁNC MINDIG A KIVÁLASZTOTT ÁGAT KÖVETI, és pontosan EGGYEL
 * hosszabb, mint a kiválasztott csomópont mélysége -- az utolsó szint az, ahol
 * még nincs választás. Ha a kiválasztott csomópontnak nincs gyereke, az utolsó
 * szint ÜRES listával áll: a hívó ebből tudja, hogy a lánc véget ért, és nem
 * kell további sort rajzolnia.
 *
 * A KIVEZETETT (`isActive: false`) HELYSZÍN NEM VÁLASZTHATÓ, de ha ÉPP AZ van
 * kiválasztva egy meglévő eszközön, a lánc akkor is felépül rajta keresztül --
 * különben a szerkesztő képernyő némán elveszítené a beállított helyszínt, és a
 * mentés átírná valami másra. Ezért a szűrés a VÁLASZTHATÓSÁGRA vonatkozik, nem
 * a láncra.
 */
export interface UnitLevel {
  /** Ezen a szinten felkínálható testvérek, kód szerint rendezve. */
  options: UnitOption[];
  /** Amit ezen a szinten már kiválasztottak, vagy `null`, ha még semmit. */
  selectedId: string | null;
}

export function unitLevels(
  units: readonly PartnerUnitLike[],
  selectedId: string | null,
): UnitLevel[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const childrenOf = (parentId: string | null) =>
    units
      .filter((unit) => unit.parentId === parentId)
      .sort((left, right) => left.code.localeCompare(right.code, "hu"))
      .map((unit) => ({
        id: unit.id,
        label: `${unit.name} (${unit.code})`,
        isActive: unit.isActive,
      }));

  // A KIVALASZTOTT CSOMOPONTTOL FELFELE epitjuk az utat, mert a sor csak a
  // szulojere hivatkozik. A `seen` a kort fogja meg: hibas adatnal e nelkul ez
  // vegtelen ciklus lenne, es a keperyon egy kimerevedett urlap latszana.
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = selectedId ? byId.get(selectedId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const levels: UnitLevel[] = [];
  let parentId: string | null = null;
  for (const stepId of path) {
    levels.push({ options: childrenOf(parentId), selectedId: stepId });
    parentId = stepId;
  }
  levels.push({ options: childrenOf(parentId), selectedId: null });
  return levels;
}

/**
 * EGY SZINT LÁTSZIK EGYSZERRE. A már eldöntött szintek becsukva állnak, és
 * alattuk pontosan EGY nyitott lista van.
 *
 * BALÁZS KÉRÉSE, ÉLES HASZNÁLATBÓL (2026-09-02 16:25, a `8e8bfd8a` kártyán),
 * szó szerint: „kiválasztja a helyszínt, akkor csak az látszik amit
 * kiválasztott és alatt feljön egy lista ami a kiválasztáshoz tartozik, ott is
 * választ az is becsukódik és jön a következő".
 *
 * MI VOLT A BAJ AZZAL, AMI ELŐTTE ÁLLT: a képernyő MINDEN szintet egyszerre
 * rajzolt ki, üres sávval elválasztva. Ettől három dolog egyszerre romlott el:
 * nem látszott, melyik csoport melyik szint, nem látszott, mi alá tartozik a
 * következő, és a lista lenyomta a többi mezőt a képernyő alja alá.
 *
 * MIÉRT TISZTA FÜGGVÉNY, ÉS NEM A KÉPERNYŐN ÁLL. Ez nem rajzolás, hanem
 * DÖNTÉS: melyik szint van kész, melyiket kell kérdezni, és mi az út, ami
 * eddig összeállt. A képernyőn ugyanez csak eszközön lenne mérhető; itt
 * állításokkal mérhető, adatbázis és szimulátor nélkül.
 *
 * A FELOLDHATATLAN LÉPÉS ÚJRA KÉRDEZÉS LESZ, NEM KITALÁLT SZÖVEG. Ha egy szint
 * kiválasztott azonosítója nincs a saját beállításai között, a szint NEM
 * eldöntöttnek számít, hanem az lesz a nyitott lista. Így nem áll elő olyan út,
 * amiben egy szakasz némán hiányzik vagy egy azonosító látszik névként.
 * (`unitLevels` kimenetén ez nem tud előfordulni: ott a kiválasztott elem
 * mindig a saját szülőjének gyermeke. A védelem attól van, hogy ez a függvény
 * a TÍPUSÁRA szól, nem egyetlen hívóra.)
 */
export interface UnitPickerStep {
  /** Hányadik szint, gyökértől nullától. A hívó ide tud visszanyitni. */
  depth: number;
  option: UnitOption;
}

export interface UnitPickerPlan {
  /** A becsukott, már eldöntött szintek, gyökértől lefelé. */
  steps: UnitPickerStep[];
  /** A NYITOTT szint: itt kell listát mutatni. `null`, ha nincs több kérdés. */
  open: { depth: number; options: UnitOption[] } | null;
  /**
   * A teljes út, emberi szemnek: `Fánk / Biodóm (BIO)`.
   *
   * AZÉRT A TELJES ÚT, ÉS NEM AZ UTOLSÓ NÉV: ugyanaz a név két különböző
   * szinten is állhat (mérve Balázs képernyőképén: „Nagymedence" a legfelső és
   * a legalsó szinten is, csak a zárójeles kód más). Egy önmagában álló név
   * ilyenkor nem mondja meg, melyiket választották.
   */
  path: string;
}

export function unitPickerPlan(levels: readonly UnitLevel[]): UnitPickerPlan {
  const steps: UnitPickerStep[] = [];
  /**
   * AZ UTAT EGY HELYEN SZAMOLJUK, ES EZ NEM STILUS.
   *
   * Elsore ket kulon `return` agban allt ugyanaz a kifejezes. A kalibracio
   * megmutatta, hogy a masodik ag `unitLevels` kimeneten SOSEM fut le (az
   * mindig ad egy zaro, eldontetlen szintet), tehat az ottani rontas NEM
   * pirosodott ki -- vagyis a ket peldany egymastol fuggetlenul elromolhatott
   * volna, es csak az egyiket meri barmi.
   */
  const path = () => steps.map((step) => step.option.label).join(" / ");

  for (let depth = 0; depth < levels.length; depth += 1) {
    const level = levels[depth]!;
    const chosen =
      level.selectedId === null
        ? undefined
        : level.options.find((option) => option.id === level.selectedId);

    if (!chosen)
      return {
        steps,
        open:
          level.options.length > 0 ? { depth, options: level.options } : null,
        path: path(),
      };

    steps.push({ depth, option: chosen });
  }

  // Minden szint eldőlt, és nincs több kérdés: a legmélyebb választásnak nincs
  // gyermeke. Az `unitLevels` ilyenkor is ad egy utolsó, ÜRES szintet, tehát
  // ide csak üres bemenettel jutunk el.
  return { steps, open: null, path: path() };
}
