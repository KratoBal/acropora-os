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
 *   handleTaken   (kartya ec82b629) a Medusan MAR ALL egy gyujtemeny a marka handle-jevel, de nem a mi azonositonkkal, es a
 *                 helyzet nem dolgozhato fel automatikusan: vagy MASIK marka azonositojat viseli (ket marka egy handle-n), vagy
 *                 a marka lekepezes-sora elavult, es a handle-t egy nem lekepezett gyujtemeny foglalja. Letrehozni NEM lehet
 *                 (a Medusa elutasitja), osszekotni NEM szabad (nem tudjuk, ugyanaz-e): jelentjuk, ember donti el
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

/** A handle-t egy olyan gyujtemeny foglalja a Medusan, amit a terv nem dolgozhat fel magatol. */
export interface BrandHandleTaken {
  ourId: string;
  handle: string;
  /** A gyujtemeny, ami a handle-t viseli a Medusan. */
  medusaId: string;
  /**
   * Mi a helyzet: `other-brand` (a handle-t masik marka azonositojat viselo gyujtemeny foglalja), `stale-mapping` (elavult sor,
   * es a handle-t egy szabad gyujtemeny foglalja) vagy `mapped-to-other-brand` (a lekepezes-sorunk cel gyujtemenye masik
   * marka azonositojat viseli).
   */
  reason: "other-brand" | "stale-mapping" | "mapped-to-other-brand";
}

export interface BrandImportPlan {
  create: BrandCreate[];
  mapOnly: BrandMapping[];
  skip: string[];
  staleMapping: string[];
  conflict: BrandMappingConflict[];
  skipArchived: string[];
  handleTaken: BrandHandleTaken[];
}

/**
 * A TERV. Csak allapot megy be, csak dontes jon ki.
 *
 * A HANDLE UTKOZESE (kartya ec82b629, merve a teszt kirakaton 2026-11-19: a `fauna-marin` handle mar letezett, a letrehozas
 * elbukott, es a hiba az egesz lepest leallitotta, tehat EGY marka miatt a tobbi 44 sem kapott gyujtemenyt). A `slug` nalunk
 * egyedi, a Medusan viszont a handle-t BARKI foglalhatta: a kezi gyujtemeny, egy korabbi futas, amit nem mi azonositottunk. A
 * terv ezert a letrehozas ELOTT megnezi a handle-t is:
 *
 *   a handle-t viselo gyujtemeny kulso azonositoja NINCS   -> ugyanaz a marka, csak nem mi jeloltuk meg: osszekotes (`mapOnly`)
 *   MASIK marka azonositojat viseli, vagy a marka sora elavult -> `handleTaken`: nem hozunk letre, nem kotunk ossze, jelentjuk
 *
 * AZ OSSZEKOTES NEM IR A MEDUSARA: csak a mi lekepezes-sorunk keletkezik. A gyujtemeny `external_id`-ja ures marad, ezert a
 * KOVETKEZO kor mar a lekepezes-sorbol latja, hogy a marka rendben van (`skip`): egy ervenyes sor, amelynek a cel gyujtemenye
 * LETEZIK a Medusan, nem elavult, akkor sem, ha az nem viseli a mi azonositonkat. Elavult csak az a sor, aminek a cel azonositoja
 * a Medusa gyujtemenyei kozott nincs.
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
  const gyujtemenyIdSzerint = new Map(
    existing.map((collection) => [collection.id, collection]),
  );
  const handleSzerint = new Map<string, ExistingCollection>();
  for (const collection of existing)
    if (!handleSzerint.has(collection.handle))
      handleSzerint.set(collection.handle, collection);
  const sorunk = new Map(mappings.map((m) => [m.ourId, m.medusaId]));

  const create: BrandCreate[] = [];
  const mapOnly: BrandMapping[] = [];
  const skip: string[] = [];
  const staleMapping: string[] = [];
  const conflict: BrandMappingConflict[] = [];
  const skipArchived: string[] = [];
  const handleTaken: BrandHandleTaken[] = [];

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

    // ERVENYES SOR, a cel gyujtemeny letezik (kulso azonosito nelkul is): nincs teendo
    const sorunkGyujtemenye = aSorunk
      ? (gyujtemenyIdSzerint.get(aSorunk) ?? null)
      : null;
    if (sorunkGyujtemenye) {
      // a sor egy MASIK marka azonositojat viselo gyujtemenyre mutat: ket marka egy gyujtemenyen, ember donti el
      if (sorunkGyujtemenye.externalId)
        handleTaken.push({
          ourId: brand.id,
          handle: sorunkGyujtemenye.handle,
          medusaId: sorunkGyujtemenye.id,
          reason: "mapped-to-other-brand",
        });
      else skip.push(brand.id);
      continue;
    }

    const foglalo = handleSzerint.get(brand.slug) ?? null;
    if (foglalo) {
      if (foglalo.externalId) {
        // MASIK marka azonositojat viseli (a miénket nem, azt fent kezeltuk): nem a mienk
        handleTaken.push({
          ourId: brand.id,
          handle: brand.slug,
          medusaId: foglalo.id,
          reason: "other-brand",
        });
      } else if (aSorunk) {
        // elavult sorunk es egy szabad, azonos handle-u gyujtemeny: az atkotes emberi dontes (nem tudjuk, ugyanaz-e)
        handleTaken.push({
          ourId: brand.id,
          handle: brand.slug,
          medusaId: foglalo.id,
          reason: "stale-mapping",
        });
      } else {
        mapOnly.push({ ourId: brand.id, medusaId: foglalo.id });
      }
      continue;
    }

    if (aSorunk) staleMapping.push(brand.id);
    create.push({ ourId: brand.id, title: brand.name, handle: brand.slug });
  }

  return {
    create,
    mapOnly,
    skip,
    staleMapping,
    conflict,
    skipArchived,
    handleTaken,
  };
}
