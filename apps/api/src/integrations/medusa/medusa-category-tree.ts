/**
 * A KATEGORIAFA ATVITELE A MEDUSABA: a DONTES resze, a halozat nelkul.
 *
 * Mit dontunk el itt: MIT kell letrehozni, MILYEN sorrendben, MILYEN cimmel, es
 * mi az, ami MAR ott van. Mit NEM: hogy a Medusa elfogadja-e. Az utobbi csak
 * eles peldanyon merheto, es azt nem en futtatom -- a hitelesites nem nalam
 * van. A ket meres kulon all, es a jelentesben is kulon jelolve.
 *
 * === A KULSO AZONOSITO A KULCS, ES A NEV SOHA ===
 *
 * A fa 219 kategoriajabol HETVENHAT nev utkozik (polip merese, 2026-09-02).
 * Egy nev alapjan parosito betoltes ezert nem "kicsit pontatlan" lenne, hanem
 * EPP AZ UTKOZO teteleknel tevedne -- ott, ahol a legdragabb.
 *
 * Ezert a mi azonositonk a Medusa `external_id` mezojebe kerul, es a
 * megismetelhetoseg AZON mulik.
 *
 * === ES AMIT A SZURESROL NEM TUDUNK, KIMONDVA ===
 *
 * Az `external_id` KULCSKENT letezik a kategorian -- acrobot merte a teszt
 * peldany STORE oldalan (2026-09-02, nyers valasz, a kulcs jelenletet nezve,
 * nem az erteket).
 *
 * AMIT EBBOL NEM TUDUNK: hogy az ADMIN API elfogadja-e iraskor, es hogy lehet-e
 * RA SZURNI (`?external_id=...`). Ezert ez a terv NEM epit szuresre: a hivo az
 * OSSZES kategoriat lekeri, es a parositas ITT tortenik, memoriaban. 219 sornal
 * ez nem draga.
 *
 * EZT AZERT KELL KIIRNI, mert egy kesobbi olvaso kulonben azt hinne, hogy a
 * szures letezik es csak lustasagbol nem hasznaljuk.
 */

/** Egy sor a fa-fajlbol. A `parentId` ures a gyokereknel. */
export interface CategoryRow {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  depth: number;
}

/** Amit a Medusa mar tud egy kategoriarol, amikor parositunk. */
export interface ExistingCategory {
  id: string;
  externalId: string | null;
}

export interface CategoryCreate {
  externalId: string;
  /** A megjelenő cim; lasd `categoryTitle`. */
  title: string;
  /**
   * A SZULO KULSO azonositoja, nem a Medusa-e. A Medusa-oldali azonosito csak
   * a letrehozas UTAN letezik, es a hivo dolga feloldani -- lasd a lenti
   * jegyzetet a sorrendrol.
   */
  parentExternalId: string | null;
}

export interface CategoryImportPlan {
  /** Amit letre kell hozni, LETREHOZASI sorrendben. */
  create: CategoryCreate[];
  /** Amit nem kell: mar all a Medusaban, a kulso azonosito szerint. */
  skip: string[];
}

/** A fejlec utan minden sor egy kategoria. Tab-elvalasztott. */
export function parseCategoryTsv(text: string): CategoryRow[] {
  const sorok = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  const fejlec = sorok.shift();
  if (!fejlec) return [];
  const oszlopok = fejlec.split("\t");
  const idx = (nev: string) => {
    const i = oszlopok.indexOf(nev);
    if (i === -1) throw new Error(`Hiányzó oszlop a fa-fájlban: ${nev}`);
    return i;
  };
  const iAz = idx("azonosito");
  const iSzulo = idx("szulo_azonosito");
  const iNev = idx("nev");
  const iMelyseg = idx("melyseg");
  return sorok.map((sor, i) => {
    const m = sor.split("\t");
    const externalId = (m[iAz] ?? "").trim();
    /**
     * URES AZONOSITOVAL NEM MEGYUNK TOVABB.
     *
     * A kulso azonosito a parositas EGYETLEN kulcsa. Egy ures ertek
     * CSENDBEN egyezne barmivel, aminek szinten nincs azonositoja -- peldaul a
     * gyari bemutato kategoriakkal --, es akkor a sajat kategoriank
     * "mar letezik" cimen kimaradna. A hiba a betoltes VEGEN latszana, egy
     * hianyzo agkent, es senki nem tudna, melyik sorbol.
     *
     * (Ezt a kalibracio hozta elo: az elso valtozatban csak egy allitas allt
     * arrol, hogy az ures azonosito ne takarjon el semmit -- es a celzott
     * rontas NEM pirositotta ki, mert a fixturaban nem volt ures azonositoju
     * sor. Az allitas nem mert semmit. Igy a kerdes fel sem merul.)
     */
    if (!externalId)
      throw new Error(`Üres azonosító a fa-fájl ${i + 2}. sorában.`);
    return {
      externalId,
      parentExternalId: (m[iSzulo] ?? "").trim() || null,
      name: (m[iNev] ?? "").trim(),
      depth: Number.parseInt(m[iMelyseg] ?? "0", 10),
    };
  });
}

/**
 * A MEGJELENO CIM. KULON FUGGVENY, ES EZ NEM STILUS.
 *
 * A mai szabaly: `{nev} - {szulo neve}`, es polip merte, hogy ez a hetvenhat
 * utkozo nevre NULLA utkozest hagy. A SZABALY ELFOGADASA VISZONT BALAZSE, es
 * meg nem tortent meg -- ezert all egy helyen: ha mast valaszt, EZ az egy
 * fuggveny valtozik, nem a betoltes.
 */
export function categoryTitle(name: string, parentName: string | null): string {
  return parentName ? `${name} - ${parentName}` : name;
}

/**
 * A SORREND ELLENORZESE: a szulo MINDIG korabban all, mint a gyereke.
 *
 * MIERT ALLITAS, ES NEM RENDEZES. A fajl mar igy all (polip onellenorzese), es
 * ha egyszer nem, azt TUDNI akarjuk, nem csendben helyrerakni: egy sorrend, ami
 * magatol javul, elrejti, hogy a forras romlott el. A letrehozas az elso mely
 * kategorianal hasalna el, mert a szulo Medusa-azonositoja meg nem letezik.
 */
export function firstOutOfOrder(rows: readonly CategoryRow[]): string | null {
  const latott = new Set<string>();
  for (const sor of rows) {
    if (sor.parentExternalId && !latott.has(sor.parentExternalId))
      return sor.externalId;
    latott.add(sor.externalId);
  }
  return null;
}

/**
 * MIT KELL LETREHOZNI, ES MIT NEM.
 *
 * A MEGISMETELHETOSEG ITT DOL EL: ami mar all a Medusaban a MI azonositonkkal,
 * az kimarad. Ket egymas utani futas utan tehat 219 kategoria all, nem 438.
 */
export function planCategoryImport(
  rows: readonly CategoryRow[],
  existing: readonly ExistingCategory[],
): CategoryImportPlan {
  const nevek = new Map(rows.map((sor) => [sor.externalId, sor.name]));
  const mar = new Set(
    existing
      .map((cat) => cat.externalId)
      .filter((azonosito): azonosito is string => Boolean(azonosito)),
  );
  const create: CategoryCreate[] = [];
  const skip: string[] = [];
  for (const sor of rows) {
    if (mar.has(sor.externalId)) {
      skip.push(sor.externalId);
      continue;
    }
    create.push({
      externalId: sor.externalId,
      title: categoryTitle(
        sor.name,
        sor.parentExternalId ? (nevek.get(sor.parentExternalId) ?? null) : null,
      ),
      parentExternalId: sor.parentExternalId,
    });
  }
  return { create, skip };
}
