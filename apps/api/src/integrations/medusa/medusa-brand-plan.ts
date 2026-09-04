/**
 * MIT KELL LETREHOZNI A MEDUSAN A MARKAINKBOL, ES MIT NEM.
 *
 * TISZTA FUGGVENY, HALOZAT ES ADATBAZIS NELKUL, ugyanabbol az okbol, amiert a
 * kategoria-terv is kulon all: a dontes igy MERHETO. Ami egy parancssori felulet
 * torzsebe kerul, azt csak eles futassal lehetne megnezni, es amit csak eles
 * futassal lehet merni, az meretlen marad.
 *
 * A HAT ESET, ES MIERT NEM KETTO. A kezenfekvo alak az lenne, hogy "letrehozni"
 * vagy "megvan". A valosag ennel tobb allapotot ismer, es a kulonbseguk a
 * TEENDOBEN van, nem a szohasznalatban:
 *
 *   skip          megvan a Medusan ES nalunk is le van kepezve, ugyanarra
 *   mapOnly       megvan a Medusan (a sajat kulso azonositonkat viseli),
 *                 de nalunk NINCS lekepezes-sor -- csak ossze kell kotni,
 *                 letrehozni NEM szabad, mert az duplikatumot szulne
 *   staleMapping  van lekepezes-sorunk, de a Medusan nincs ilyen gyujtemeny.
 *                 A sor elavult, es a helyes teendo a letrehozas UTAN az
 *                 atkotes -- nem a nema felulirás
 *   conflict      MINDKETTO letezik, de MAST mond. Ez az egyetlen eset, ahol
 *                 semmit nem teszunk magunktol: ember donti el
 *   create        egyik oldalon sincs
 *   skipArchived  a marka nalunk archivalt vagy inaktiv -- nem visszuk ki
 *
 * A `conflict` azert kulon eset, es azert nem "majd felulirjuk": ha a
 * lekepezes-sorunk egy MASIK gyujtemenyre mutat, mint amelyik a mi kulso
 * azonositonkat viseli, akkor ket gyujtemeny all a Medusan ugyanarra a markara.
 * Egy automata dontes kozuluk az egyiket csendben elarvitana, es a termekek fele
 * az egyikhez, fele a masikhoz tartozna.
 */

/**
 * OLVASASI SZABALY A KIMENETHEZ: KET HASONLO NEVU GYUJTEMENY NEM ENNEK A
 * MODULNAK A HIBAJA.
 *
 * Ha a boltban valaha ket gyujtemeny all ugyanarra a markara, hasonlo nevvel, a
 * hiba NEM itt van es nem a betoltoben: az ket BRAND SOR kovetkezmenye nalunk.
 * Ez a modul pontosan azt teszi, amit a tabla mond -- markankent egy
 * gyujtemenyt.
 *
 * ES A KET SOR LETREJOTTE MERT, NEM ELMELETI (2026-09-04): a Brand.normalizedName
 * unique megkotese CSAK azonos normalizalt nevet utkoztet, es ket kulon uton
 * erkezo irasmod normalizalt neve kulonbozhet. A mert pelda a "Magfloat" (a
 * marka-mezobol jovo import alakja) es a "Mag-Float" (a termek NEVEBOL dolgozo
 * felismero alakja): normalizalva "magfloat" kontra "mag float", tehat a unique
 * megkotes nem fogja meg oket.
 *
 * A JAVITAS HELYE EZERT A SZOTAR VAGY A BrandAlias, NEM EZ A MODUL. Ha a betolto
 * elkezdene irasmodokat osszevonni, egy MASODIK, rejtett normalizalo keletkezne
 * a meglevo mellett, es a ketto elobb-utobb szetcsuszna. A nyitott adatkerdes
 * (osszekoti-e ma a BrandAlias a ket alakot) sajat kartyan all; a darabszamot
 * szandekosan nem irjuk ide, mert egy szovegbe egetett szam a valosag
 * elmozdulasakor csendben hazuggá valik.
 */

/** Egy marka nalunk, annyi mezovel, amennyi a dontesehez kell. */
export interface OurBrand {
  id: string;
  name: string;
  /** A Medusa `handle` mezoje ebbol lesz: nalunk egyedi. */
  slug: string;
  isActive: boolean;
  archivedAt: Date | null;
}

/** Egy gyujtemeny a Medusan, ahogy a lista visszaadja. */
export interface ExistingCollection {
  id: string;
  handle: string;
  /** A mi marka-azonositonk, ha ezt a gyujtemenyt mi hoztuk letre. */
  externalId: string | null;
}

/** Egy lekepezes-sor: a mi markank, es a Medusa-oldali gyujtemeny. */
export interface BrandMapping {
  ourId: string;
  medusaId: string;
}

export interface BrandCreate {
  ourId: string;
  title: string;
  handle: string;
}

export interface BrandMappingConflict {
  ourId: string;
  /** Amire a mi lekepezes-sorunk mutat. */
  mappedMedusaId: string;
  /** Amelyik gyujtemeny a mi kulso azonositonkat viseli a Medusan. */
  medusaIdCarryingOurId: string;
}

export interface BrandImportPlan {
  create: BrandCreate[];
  mapOnly: BrandMapping[];
  skip: string[];
  staleMapping: string[];
  conflict: BrandMappingConflict[];
  skipArchived: string[];
}

/**
 * A TERV. Csak allapot megy be, csak dontes jon ki.
 *
 * A HANDLE UTKOZESET NEM EZ A FUGGVENY OLDJA FEL, es ez szandekos: a `slug`
 * nalunk egyedi (a sema `@unique` megkotese), tehat ket markanak nem lehet
 * ugyanaz. Ha a Medusan MEGIS all egy azonos handle-u gyujtemeny, amit nem mi
 * hoztunk letre, azt a letrehozas fogja elutasitani -- es az helyes: az a sor
 * emberi dontes, nem automatikus atvetel.
 */
export function planBrandImport(
  brands: readonly OurBrand[],
  existing: readonly ExistingCollection[],
  mappings: readonly BrandMapping[] = [],
): BrandImportPlan {
  const medusaIdMiAzonositonkra = new Map<string, string>();
  for (const collection of existing)
    if (collection.externalId)
      medusaIdMiAzonositonkra.set(collection.externalId, collection.id);
  const sorunk = new Map(mappings.map((m) => [m.ourId, m.medusaId]));

  const create: BrandCreate[] = [];
  const mapOnly: BrandMapping[] = [];
  const skip: string[] = [];
  const staleMapping: string[] = [];
  const conflict: BrandMappingConflict[] = [];
  const skipArchived: string[] = [];

  for (const brand of brands) {
    /**
     * AZ ARCHIVALT MARKA A LEGELSO SZURO, MEG A LEKEPEZES ELOTT.
     *
     * Nem azert, mert "ugysem lenne mit tenni": ha kesobb kerulne sorra, egy
     * mar lekepezett, azota archivalt marka a `skip` agba esne, es a jelentes
     * azt mondana rola, hogy rendben van. Igy viszont megjelenik a sajat
     * listajaban, es latszik, hogy TUDATOSAN maradt ki.
     */
    if (!brand.isActive || brand.archivedAt) {
      skipArchived.push(brand.id);
      continue;
    }

    const aMedusaban = medusaIdMiAzonositonkra.get(brand.id) ?? null;
    const aSorunk = sorunk.get(brand.id) ?? null;

    if (aMedusaban && aSorunk) {
      if (aSorunk === aMedusaban) skip.push(brand.id);
      else
        conflict.push({
          ourId: brand.id,
          mappedMedusaId: aSorunk,
          medusaIdCarryingOurId: aMedusaban,
        });
      continue;
    }

    if (aMedusaban) {
      mapOnly.push({ ourId: brand.id, medusaId: aMedusaban });
      continue;
    }

    if (aSorunk) staleMapping.push(brand.id);
    create.push({ ourId: brand.id, title: brand.name, handle: brand.slug });
  }

  return { create, mapOnly, skip, staleMapping, conflict, skipArchived };
}
