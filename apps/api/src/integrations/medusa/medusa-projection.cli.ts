import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  decideMedusaCategories,
  describeMissingCategoryMapping,
  MEDUSA_CATEGORY_REFERENCE,
} from "./medusa-category.policy.js";
import {
  decideMedusaBarcode,
  describeSkippedBarcode,
} from "./medusa-barcode.policy.js";
import {
  decideMedusaBrandCollection,
  describeMissingBrandMapping,
  MEDUSA_BRAND_REFERENCE,
} from "./medusa-brand.policy.js";
import { isKnownCatalogAuthority } from "./medusa-publication.policy.js";

import {
  describeMedusaFailure,
  MedusaAdminHttpError,
  MedusaConfigurationError,
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import {
  MEDUSA_PRODUCT_REFERENCE,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectionPublicationReport,
} from "./medusa-product-projection.service.js";
import { storefrontSalesChannelId } from "./medusa-sales-channel.config.js";
import { createDocumentStore } from "../../service-assets/document-store/document-store.provider.js";
import { MedusaImageLinkRepository } from "./medusa-image-link.repository.js";
import { parseBatchArguments } from "./medusa-projection-batch.js";
import { copyProductImages } from "./product-image-copier.js";
import { publishProductImages } from "./product-image-publisher.js";

/**
 * KÉZZEL indított vetítés, termékazonosítónként.
 *
 * Szándékosan nincs ütemező és nincs kötegelés: ez a kör az első, ellenőrzött
 * átvitel, és az első éles betöltésnek ember által indított, egyszeri
 * műveletnek kell lennie. Ha ütemezőbe kötnénk, az első futás egy naplósorrá
 * válna, amit senki nem néz meg akkor, amikor a legfontosabb lenne.
 *
 * Használat:
 *   pnpm --filter @acropora/api medusa:project <termékazonosító> [további...]
 *   pnpm --filter @acropora/api medusa:project sku:TESZT0001 [további...]
 *
 * A `sku:` előtag azért van, mert ember cikkszámot ismer, nem belső
 * azonosítót. Előtag nélkül a paraméter termékazonosító. NEM találgatunk a két
 * alak között: egy „melyik lehet ez" heurisztika pont akkor tévedne, amikor egy
 * cikkszám véletlenül azonosítónak látszik.
 *
 * A KULCSOT NEM KELL ÁTADNI: a parancs a tárolt hitelesítő adatból dolgozik,
 * amit a Beállítások oldalon lehet megadni. A környezeti változó tartalék marad,
 * de nem néma: ha azon az úton megy, a parancs egy sorban kimondja. A CÍM
 * (`MEDUSA_ADMIN_URL`) továbbra is a környezetből jön, mert az nem titok.
 */

/**
 * A TARTALÉK ÚT KIMONDÁSA, egy sorban.
 *
 * A tartalék természete, hogy MŰKÖDIK, és amíg működik, senki nem veszi észre,
 * hogy még mindig azt használjuk. Így lesz egy átmenetből állapot. Enélkül a sor
 * nélkül a kör állítása nem is ellenőrizhető: valaki futtatná környezeti
 * változóval, látná, hogy megy, és azt hinné, hogy a tárolt úton ment.
 */
export const MEDUSA_PROJECTION_FALLBACK_NOTICE =
  "TARTALÉK ÚT: a kulcs a MEDUSA_ADMIN_API_KEY környezeti változóból jött, " +
  "mert tárolt hitelesítő adat nincs beállítva. Állítsd be a Beállítások " +
  "oldalon, hogy a titok ne a folyamat környezetében éljen.";

/**
 * A KULCS a tárolóból, a CÍM a környezetből.
 *
 * Ez a kör állítása: a vetítés a kulcs parancssori vagy környezeti átadása
 * NÉLKÜL is lefut, tehát a titok többé nem kerül a héj előzményeibe és a
 * folyamatlistába. A cím marad a környezetben, mert az nem titok.
 *
 * Azért külön, exportált függvény, és nem a parancs törzsébe írt néhány sor,
 * mert MÉRHETŐNEK kell lennie adatbázis nélkül. A kliens a VALÓDI gyárral
 * készül, csak a `fetch` cserélhető: egy teszt, ami saját hamis klienst adna át,
 * pontosan ezt az utat NEM mérné, és zöld maradna akkor is, ha ide bárki
 * visszacsempész egy környezeti kulcs-olvasást.
 */
/**
 * A publikációs rész a jelentés sorában.
 *
 * Külön, exportált függvény, és nem a parancs törzsébe írt néhány sor: egy
 * jelentés-szöveg, ami csak egy adatbázissal és egy hálózattal mérhető, nem
 * mérhető. A brief 11. tesztje pont ezt a szöveget követeli meg.
 *
 * Egy "updated" sor önmagában nem mondja meg, mi lett a termékkel: attól még
 * lehet draft és lekötve. A csatorna NEVE azért van benne, mert egy rossz, de
 * létező azonosítót ez mutat meg - és nem egy ellenőrzés, ami egy jogos
 * átnevezésre is pirosodna.
 */
export function describePublication(
  publication: ProjectionPublicationReport,
): string {
  /**
   * A NÉV a LEKÖTÉSNÉL IS kiíródik, és ezt a brief javította ki rajtam.
   *
   * Az első változatom a lekötésnél elhagyta, azzal az indokkal, hogy a név
   * odatartozást sugallna. Ez gyengébb érv annál, amit cserébe elveszít: a
   * névre pontosan azért van szükség, hogy egy ROSSZ, de létező csatorna
   * azonosító kiderüljön - és a lekötés ugyanolyan művelet egy csatornán,
   * mint a hozzákötés. Aki egy másik bolt csatornájáról köt le egy terméket,
   * annak ugyanúgy látnia kell, melyikről.
   */
  const action =
    publication.salesChannel === "attach" ? "attached" : "detached";

  return [
    `publication: ${publication.status}`,
    `sales channel: ${action} -> ${publication.salesChannelName}`,
    `reason: ${publication.reason}`,
  ].join("\n      ");
}

export async function medusaClientForProjection(
  credentials: MedusaCredentialProvider,
  out: { stdout(value: string): void; stderr(value: string): void },
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): Promise<MedusaAdminClient> {
  const resolved = await credentials.resolve();

  if (resolved.source === "env")
    out.stderr(`${MEDUSA_PROJECTION_FALLBACK_NOTICE}\n`);
  // A REVÍZIÓ a kulcs azonossága, nem a kulcs: ez mehet a kimenetre.
  else
    out.stdout(
      `A tárolt hitelesítő adatot használom (${resolved.revision}).\n`,
    );

  return medusaClientFromEnvironment(resolved.apiKey, env, fetchImpl);
}

/** Amit a parancs használ, ha a hívó nem ad mást: a tárolt kulcs útja. */
export function storedCredentialProvider(): MedusaCredentialProvider {
  return new MedusaCredentialProvider(
    new MedusaConnectionRepository(),
    new MedusaCredentialCryptoService(),
  );
}

/**
 * Egy sor, embernek. A hitelesítő adat hiánya nem programhiba, hanem a futtatás
 * első lépése, amit el lehet felejteni; a sérült adat viszont igen, és a kettő
 * NEM látszhat ugyanannak.
 */
export function describeCredentialFailure(
  error: MedusaConnectionError,
): string {
  if (
    error.code === "MEDUSA_CONNECTION_NOT_CONFIGURED" ||
    error.code === "MEDUSA_CONNECTION_CONFIGURATION_MISSING"
  )
    return (
      "A Medusa hitelesítő adat nincs beállítva. Állítsd be a Beállítások " +
      "oldalon (Medusa kapcsolat), és futtasd újra."
    );
  if (error.code === "MEDUSA_CONNECTION_DISABLED")
    return "A Medusa kapcsolat le van tiltva, ezért a vetítés nem fut.";
  return `A tárolt Medusa hitelesítő adat nem használható (${error.code}).`;
}

/**
 * Cikkszámból termékazonosító - és a KÉT SIKERTELEN ESET KÜLÖN.
 *
 * Eddig mindkettő `null` volt, és egyetlen mondatot kapott: „nincs ilyen
 * cikkszámú aktív változat". A mondat IGAZ volt, de KÉT különböző állapotot
 * fedett, és a teendő nem ugyanaz: ha nincs ilyen cikkszám, elgépelés vagy
 * rossz termék; ha van, de inaktív, akkor a cikkszám jó és aktiválni kell.
 *
 * A lekérdezés nem változik (`findUnique` a cikkszámra, ami egyedi oszlop) -
 * csak nem dobjuk el azt, amit már úgyis megmértünk.
 */
type SkuLookup =
  | { found: true; productId: string }
  | { found: false; reason: "no-such-sku" | "variant-inactive" };

async function resolveBySku(sku: string): Promise<SkuLookup> {
  const variant = await prisma.productVariant.findUnique({
    where: { sku },
    select: { productId: true, isActive: true },
  });
  if (!variant) return { found: false, reason: "no-such-sku" };
  if (!variant.isActive) return { found: false, reason: "variant-inactive" };
  return { found: true, productId: variant.productId };
}

/** Melyik sikertelen eset áll fenn, embernek. Exportált, hogy mérhető legyen. */
/**
 * A CSATORNA-SOR HAT MEZOJE -> A VETITES BEMENETE, EGY TISZTA FUGGVENYBEN.
 *
 * KULON FUGGVENY, ES EZ MERESI KERDES, NEM STILUS. A parancs torzse a `prisma`-t
 * MODUL-SZINTU importbol veszi, tehat ami ott all, azt csak eles adatbazissal
 * lehetne megnezni -- ugyanaz az ok, amiert a kategoria- es a marka-szabaly is
 * kulon modulban all. Enelkul a lekepezes elrontasara SEMMI nem szolna, es ezt
 * nem feltetelezem: a kalibraciom megmutatta, hogy egy rontas a parancs
 * torzseben NULLA allitast dontott pirosra.
 *
 * A hianyzo sor NEM hibaallapot: egy termeknek nem kotelezo UNAS-csatorna sora
 * lennie, es akkor mind a hat ertek `null`.
 */
export interface UnasChannelRow {
  slug: string | null;
  seoRobots: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  productUrl: string | null;
}

export interface UnasChannelProjection {
  slug: string | null;
  seoRobots: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  unasProductUrl: string | null;
}

/**
 * A VALTOZAT MEZOI -> A VETITES BEMENETE, EGY TISZTA FUGGVENYBEN.
 *
 * UGYANAZ AZ OK, MINT A CSATORNA-SORNAL, ES MA MASODSZOR MERTEM MEG: a parancs
 * torzsebe irt lekepezes rontasa NULLA allitast dont pirosra, mert a `prisma`
 * modul-szintu import mellett a torzs eles adatbazis nelkul nem merheto. A
 * kalibracio elso koreben pontosan ez tortent a szorzoval.
 *
 * A SZORZO ITT VALIK SZOVEGGE, es ez a fuggveny egyetlen nem trivialis lepese: a
 * `Decimal` a Prisma tipusa, a metaadat viszont kulcs-ertek parokat tart. A
 * `toString` a TAROLT pontossagot adja vissza, nem egy talalgatast -- egy
 * `Number()` konverzio hat tizedesnel csendben kerekitene.
 */
export interface ValtozatMezok {
  unit?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitFactor?: { toString(): string } | null;
}

export interface ValtozatProjekcio {
  unit: string | null;
  secondaryUnit: string | null;
  secondaryUnitFactor: string | null;
}

export function projectValtozatMezok(
  valtozat: ValtozatMezok | undefined,
): ValtozatProjekcio {
  return {
    unit: valtozat?.unit ?? null,
    secondaryUnit: valtozat?.secondaryUnit ?? null,
    secondaryUnitFactor: valtozat?.secondaryUnitFactor?.toString() ?? null,
  };
}

/**
 * A RENDELESI KORLATOK A TUKORBOL, MAR SZOVEGKENT.
 *
 * KULON, EXPORTALT TISZTA FUGGVENY, ugyanabbol az okbol, mint a valtozat-mezok
 * es a csatorna-sor lekepezese: a parancs torzsebe irt lekepezes rontasa NULLA
 * allitast dont pirosra, mert a `prisma` modul-szintu importja mellett a torzs
 * eles adatbazis nelkul nem merheto.
 *
 * A HAROM MEZO A `UnasProductSnapshot` MODELLEN UL, nem a varianson es nem a
 * terméken -- ezert jon MASIK relaciobol, mint a mertekegyseg.
 *
 * A NEGYEDIK, az `initialOrderQuantity`, SZANDEKOSAN HIANYZIK: merve az egesz
 * fan, mindossze KET elofordulasa van (a sema es a migracio), nulla iras es
 * nulla olvasas. A UNAS kliens ki sem bontja, tehat a tukorbe el sem jut. Nincs
 * mit atvinni belole, es a torlese kulon dontes.
 */
export interface TukorKorlatok {
  minimumOrderQuantity?: { toString(): string } | null;
  maximumOrderQuantity?: { toString(): string } | null;
  orderQuantityStep?: { toString(): string } | null;
}

export interface KorlatProjekcio {
  minimumOrderQuantity: string | null;
  maximumOrderQuantity: string | null;
  orderQuantityStep: string | null;
}

export function projectRendelesiKorlatok(
  snapshot: TukorKorlatok | null | undefined,
): KorlatProjekcio {
  return {
    minimumOrderQuantity: snapshot?.minimumOrderQuantity?.toString() ?? null,
    maximumOrderQuantity: snapshot?.maximumOrderQuantity?.toString() ?? null,
    orderQuantityStep: snapshot?.orderQuantityStep?.toString() ?? null,
  };
}

export function projectUnasChannelRow(
  row: UnasChannelRow | undefined,
): UnasChannelProjection {
  return {
    slug: row?.slug ?? null,
    seoRobots: row?.seoRobots ?? null,
    seoTitle: row?.seoTitle ?? null,
    seoDescription: row?.seoDescription ?? null,
    seoKeywords: row?.seoKeywords ?? null,
    /**
     * A NEV ITT VALTOZIK, es ez a fuggveny egyetlen nem trivialis lepese: a
     * csatorna-soron `productUrl`, a vetites bemeneten `unasProductUrl`. A ket
     * nev NEM ugyanaz a fogalom -- a masodik kimondja, MELYIK bolt cimerol van
     * szo --, es epp az ilyen atnevezes csuszik el csendben egy select
     * boviteskor.
     */
    unasProductUrl: row?.productUrl ?? null,
  };
}

export function describeSkuLookupFailure(
  sku: string,
  reason: "no-such-sku" | "variant-inactive",
): string {
  return reason === "no-such-sku"
    ? `sku:${sku}: nincs ilyen cikkszámú változat`
    : `sku:${sku}: van ilyen cikkszámú változat, de INAKTÍV. A cikkszám tehát ` +
        `jó; a teendő a változat aktiválása, nem másik cikkszám keresése.`;
}

/**
 * A LEKEPEZES-TORLES MONDATA, ES MIERT KULON FUGGVENY.
 *
 * A parancs torzse a `prisma`-t modul-szintu importbol veszi, tehat ami ott
 * all, azt csak eles adatbazissal lehetne megnezni. A tobbi leiro
 * (`describeSkuLookupFailure`, `describePublication`) ugyanezert all kulon.
 *
 * ES A NULLA ESET KULON MONDAT, NEM CSAK MAS SZAM. A regi szoveg nulla sornal
 * is azt allitotta, hogy "lekepezes torolve (0 sor)" -- kijelentette a torlest,
 * holott nem volt mit torolni. Ket okbol allhat elo, es a masodik NEMA:
 *
 *   a termek eleve nem volt lekepezve  -> rendben, nincs teendo
 *   a keresesi kulcs elcsuszott        -> a lekepezes OTT MARAD, es a mondat
 *                                         megnyugtat
 */
/**
 * A REGI ES AZ UJ BOLTI CIM, EGY SORBAN -- ES `""`, HA NINCS MIT MONDANI.
 *
 * === MIERT A PARANCS KIMENETEN, ES NEM KULON FAJLBAN ===
 *
 * Az atiranyitasokhoz kell egy REGI-UJ lista, es a kisbetusites EGYIRANYU:
 * kesobb a regi cim mar sehonnan nem all elo. A legkisebb alak, ami ezt
 * megorzi, egy sor a kimeneten: a futast ugyis naploba iranyitja, aki
 * futtatja, tehat a lista MAGATOL megmarad -- uj fajl-kezeles, uj jogosultsag
 * es uj hibaag nelkul.
 *
 * NEM atiranyitas-kezeles. Ez a lista a FORRASA lesz, amikor az uj bolt
 * elesedik; hogy mi olvassa fel, kulon dontes.
 *
 * === URES SOR, HA A KET CIM AZONOS ===
 *
 * Olyankor a regi cim tovabbra is mukodik, es egy onmagara mutato sor csak
 * zaj lenne -- a mai adaton 14 termek. Aki a kimenetet szuri, ne kapjon
 * olyan sort, amivel nincs teendo.
 */
export function describeCimValtozas(
  cim: { regi: string; uj: string } | null,
): string {
  if (!cim) return "";
  return `      CIM: ${cim.regi} -> ${cim.uj}\n`;
}

/**
 * A MESTER ATHOZASA EGY TERMEKNEL, EGY SORBAN -- ES `""`, HA NEM TORTENT SEMMI.
 *
 * === MIERT KELL EGYALTALAN LATNI ===
 *
 * A masolas NEM forditható vissza konnyen: 3426 kep athozasa utan egy rossz
 * futast fajlonkent kellene rendezni. Ezert az ELSO futas legyen olyan, amit
 * kozben MEG LEHET NEZNI -- nem korlatozas, hanem lathatosag (acrobot, 2026-09-04).
 *
 * A szamlalo termekenkent all ki, tehat a futas kozben latszik, hol tart, es
 * egy Ctrl-C utan is tudni lehet, meddig jutott.
 *
 * === A BUKAS KULON SZAMBAN ALL, NEM A SIKERBE OLVASZTVA ===
 *
 * Egy megszunt URL vagy egy lassu valasz nem allitja meg a tobbit, es a sor
 * VALTOZATLAN marad -- tehat a kovetkezo futas ujra probalja. Ha a bukas a
 * sikerrel egy szamban allna, egy csendben fogyo keszlet ugy nezne ki, mint egy
 * kesz munka.
 */
export function describeKepMasolas(
  outcome: { copied: number; alreadyStored: number; failed: unknown[] } | null,
): string {
  if (!outcome) return "";
  if (!outcome.copied && !outcome.failed.length) return "";
  const reszek = [`${outcome.copied} kép áthozva`];
  if (outcome.alreadyStored)
    reszek.push(`${outcome.alreadyStored} már megvolt`);
  if (outcome.failed.length)
    reszek.push(`${outcome.failed.length} NEM sikerült (a sor változatlan)`);
  return `      MESTER: ${reszek.join(", ")}\n`;
}

export function describeForgottenLink(
  productId: string,
  removedRows: number,
): string {
  return removedRows > 0
    ? `${productId}: leképezés törölve (${removedRows} sor). A termék érintetlen.`
    : `${productId}: NEM volt leképezése, így nem is töröltünk semmit. A termék érintetlen.`;
}

export async function runProjectionCli(
  productIds: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  /** A hitelesítő adat útja. Paraméter, hogy adatbázis nélkül is mérhető legyen. */
  credentials: MedusaCredentialProvider = storedCredentialProvider(),
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  if (!productIds.length) {
    out.stderr("Adj meg legalább egy termékazonosítót.\n");
    return 1;
  }

  /**
   * A `--forget-link` CSAK a leképezés sorát törli, a terméket sem itt, sem
   * odaát nem érinti. A harmadik bizonyításhoz kell (az elveszett leképezés
   * helyreállítása), és azért van a parancsban, hogy ne kelljen kézzel írt
   * DELETE utasítást adni valakinek egy éles adatbázisra. A vetítés
   * újrafuttatása vissza is állítja.
   */
  /**
   * AZ ERTELMEZES KULON MODULBAN AL, ES A HIBAT ITT IRJUK KI.
   *
   * A kotegeles nelkul a parancs csak kezzel felsorolt azonositokat vett, es a
   * teljes katalogushoz (1893 termek) semmilyen alakban nem ment. Az
   * ertelmezes azert tiszta fuggveny, mert a parancs torzsenek nem lehet
   * teszt-duplat adni -- egy elgepelt kapcsolo viszont CSENDBEN mast futtatna.
   */
  const parsed = parseBatchArguments(productIds);
  if (parsed.kind === "error") {
    out.stderr(`${parsed.message}\n`);
    return 1;
  }
  const { forgetOnly, from, limit } = parsed.selection;

  /**
   * A KOTEG STABIL RENDEZESSEL JON, es ez nem kozmetika: a `--from` egy adott
   * ponttol folytat, es egy rendezetlen lekerdezes minden futasnal MAS ablakot
   * adna -- ugyanaz a parancs ketszer futtatva termekeket hagyna ki es
   * ismetelne, csendben.
   *
   * A `gt` (nem `gte`) azert kell, mert a `--from` a MAR MEGVOLT utolso
   * azonosito: azt nem akarjuk megegyszer.
   */
  const targets = parsed.selection.targets.length
    ? parsed.selection.targets
    : (
        await prisma.product.findMany({
          where: from ? { id: { gt: from } } : {},
          orderBy: { id: "asc" },
          take: limit ?? undefined,
          select: { id: true },
        })
      ).map((row) => row.id);

  if (!targets.length) {
    /**
     * A KOTEG ES A FELSOROLAS URES ESETE MAS UZENETET KAP.
     *
     * Egy ures koteg NEM hiba: azt jelenti, hogy a `--from` utan mar nincs
     * termek, tehat a menet VEGIGERT. Egy kozos "adj meg azonositot" sor itt
     * azt sugallna, hogy a hivo rontott el valamit.
     */
    out.stdout(
      from
        ? `A(z) ${from} után nincs több termék: a menet végigért.\n`
        : "Nincs vetíthető termék.\n",
    );
    return 0;
  }

  let service: MedusaProductProjectionService | null = null;
  /**
   * A KEP-OLDALI VARRATOK KULON ALLNAK, MERT MAS AZ ELETUK.
   *
   * A vetites-szolgaltatas a kliens KORE epul; a kep-kivitel UGYANAZT a
   * klienst hasznalja (a feltoltes az `uploadFile`-on megy), de a lekepezese
   * mas tabla. Egy kozos konstruktorba tomorites azt sugallna, hogy a ketto
   * egyutt romlik el -- pedig a kep-lekepezes hianya nem akadalyozza a
   * termek-vetitest.
   */
  let imageClient: MedusaAdminClient | null = null;
  const imageLinks = new MedusaImageLinkRepository();
  if (!forgetOnly) {
    try {
      imageClient = await medusaClientForProjection(credentials, out);
      service = new MedusaProductProjectionService(
        new MedusaProductLinkRepository(),
        imageClient,
        storefrontSalesChannelId(env),
      );
    } catch (error) {
      /**
       * A KÉT HIÁNY KÜLÖN SORT KAP, mert a teendő is más: a kulcs a
       * Beállítások oldalon áll be, a cím a környezetben.
       */
      if (error instanceof MedusaConnectionError) {
        out.stderr(`${describeCredentialFailure(error)}\n`);
        return 1;
      }
      if (error instanceof MedusaConfigurationError) {
        out.stderr(`${error.message}\n`);
        return 1;
      }
      /**
       * A HARMADIK AG, ES A LEGCSENDESEBB: A TOVABBDOBOTT HTTP-HIBA.
       *
       * Egy `MedusaAdminHttpError` eddig ITT ment tovabb, es a parancs
       * belepesi pontja korul NINCS `try/catch` -- tehat kezeletlen
       * kivetelkent allt meg, es a Node a TELJES stack trace-t kiirta, benne az
       * `error.message` ertekevel. Az pedig a valasz elso 500 karakteret is
       * viszi.
       *
       * Vagyis a `describeMedusaFailure` vedelme allt, csak EZEN az uton nem
       * ment at semmi. Ugyanaz a javitas, mint a keszlet-vetitesnel: a STATUSZ
       * megy ki, a torzs nem -- es a parancs HIBAKODDAL all meg, nem
       * osszeomlassal.
       */
      if (error instanceof MedusaAdminHttpError) {
        out.stderr(
          `A Medusa nem fogadta a kapcsolódást: ${describeMedusaFailure(error)}\n`,
        );
        return 1;
      }
      throw error;
    }
  }

  let failed = 0;
  /**
   * HANY VONALKODOT ZART KI AZ ISMETLODES-SZURO.
   *
   * A termekenkenti sor megnevezi az egyes eseteket, de egy sok szazas futasban
   * elvesz kozottuk. Ez a szam a futas VEGEN all, es azt mondja meg, mekkora a
   * halmaz -- egy szuro, ami sosem mond semmit, nem szuro, hanem tartalek.
   *
   * ES NEM A FORRAS-OLDALI MERT SZAMOT IRJUK KI: azt a MI adatunkon szamoljuk,
   * mert a ketto elterhet, es a kulonbseg maga is lelet lenne.
   */
  let kihagyottVonalkod = 0;
  let masoltKepek = 0;
  let bukottKepek = 0;
  for (const argument of targets) {
    let productId: string;
    if (argument.startsWith("sku:")) {
      const lookup = await resolveBySku(argument.slice(4));
      if (!lookup.found) {
        out.stderr(
          `${describeSkuLookupFailure(argument.slice(4), lookup.reason)}\n`,
        );
        failed += 1;
        continue;
      }
      productId = lookup.productId;
    } else productId = argument;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        description: true,
        descriptionLong: true,
        catalogAuthority: true,
        isActive: true,
        webshopSellable: true,
        /**
         * A MARKA, ES CSAK AZ AZONOSITOJA.
         *
         * A nevre itt nincs szukseg: a Medusa-oldali gyujtemeny NEVET az hozza
         * letre, aki a gyujtemenyt letrehozza, nem a vetites. Innen csak azt
         * kerdezzuk meg, MELYIK markarol van szo, hogy a lekepezest meg tudjuk
         * keresni.
         */
        brandId: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            sku: true,
            manufacturerPartNumber: true,
            unit: true,
            secondaryUnit: true,
            secondaryUnitFactor: true,
          },
        },
        /**
         * A RENDELESI KORLATOK A TUKORBOL, ES CSAK A HAROM MEZO.
         *
         * A `unasSnapshot` a UNAS TUKRE: nem a mi torzsadatunk, hanem az, amit
         * a forras allit. A rendelesi korlatok ott ulnek, nem a terméken es nem
         * a varianson, ezert kell kulon relacio.
         */
        unasSnapshot: {
          select: {
            minimumOrderQuantity: true,
            maximumOrderQuantity: true,
            orderQuantityStep: true,
          },
        },
        categories: { select: { categoryId: true } },
        /**
         * A MAI BOLTI CIM, ES CSAK A UNAS CSATORNAROL.
         *
         * A `ChannelListing` tobb csatornat is hordozhat; a `slug`, amit at
         * akarunk vinni, a UNAS-bol jott (a szinkron a `sefUrl`-t irja ide).
         * Egy szures nelkuli `findFirst` egy masik csatorna cimet hozna, ha
         * valaha lesz ilyen -- es a hiba csak a boltban latszana.
         */
        channelListings: {
          where: { channel: "UNAS" },
          select: {
            slug: true,
            seoRobots: true,
            seoTitle: true,
            seoDescription: true,
            seoKeywords: true,
            productUrl: true,
          },
          take: 1,
        },
        /**
         * A KEPEK SORRENDBEN, es a `sortOrder` NEM elhagyhato: a cel oldalon a
         * tomb sorrendje adja a rangot, es az ELSO elem lesz a fo kep. Egy
         * rendezetlen lekerdezes csendben mas fo kepet adna minden futasnal.
         */
        images: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, url: true, storageKey: true, fileName: true },
        },
      },
    });

    if (!product) {
      out.stderr(`${argument}: nincs ilyen termék (${productId})\n`);
      failed += 1;
      continue;
    }

    /**
     * Csak azt vetítjük ki, aminek a törzsadata a MIÉNK. Egy UNAS-gazdájú
     * terméket átvinni annyi lenne, mint a webshop adatát egy harmadik helyre
     * másolni, ahol senki nem gondozza.
     */
    if (!isKnownCatalogAuthority(product.catalogAuthority)) {
      out.stderr(
        `${productId}: a törzsadat gazdája ismeretlen (${product.catalogAuthority ?? "nincs megadva"}), kihagyva\n`,
      );
      failed += 1;
      continue;
    }

    if (forgetOnly) {
      const removed = await prisma.externalReference.deleteMany({
        where: {
          ...MEDUSA_PRODUCT_REFERENCE,
          entityId: product.id,
        },
      });
      out.stdout(`${describeForgottenLink(product.id, removed.count)}\n`);
      continue;
    }

    /**
     * A MI KATEGORIAINK -> MEDUSA AZONOSITOK.
     *
     * Itt csak a LEKERDEZES all; maga a szabaly a `medusa-category.policy.ts`
     * modulban, mert ez a fuggveny a `prisma`-t MODUL-SZINTU importbol veszi,
     * tehat ami ide kerul, azt csak eles adatbazissal lehetne megmerni.
     *
     * A lekepezes-sorokat az irja, aki a kategoriakat a Medusaban LETREHOZZA
     * (`ExternalReference`, `system: "MEDUSA"`): a Medusa-azonosito ott
     * keletkezik, nem itt.
     *
     * A HAROM ESETBOL KETTO ITT VALIK SZET: a keres torzsere nezve a "nincs
     * kategoriaja" es a "van, de meg nincs lekepezve" ugyanaz (egyik sem kuld
     * mezot), de a masodik HIANY, ezert kiirodik.
     */
    const osCategoryIds = product.categories.map((row) => row.categoryId);
    const categories = decideMedusaCategories(
      osCategoryIds,
      osCategoryIds.length
        ? await prisma.externalReference.findMany({
            where: {
              ...MEDUSA_CATEGORY_REFERENCE,
              entityId: { in: osCategoryIds },
            },
            select: { entityId: true, externalId: true },
          })
        : [],
    );
    /**
     * A HIANY SORA A STDOUT-RA MEGY, NEM A STDERR-RE, ES EZ NEM IZLES.
     *
     * Egy utemezett futast burkolo szkript gyakran a STDERR JELENLETET olvassa
     * hibanak, akkor is, ha a kilepesi kod nulla. A hianyzo lekepezes viszont
     * NEM bukas: a vetites lefut, a termek kimegy, csak kategoria nelkul -- es
     * amig a betoltes nincs kesz, MINDEN kategoriaval rendelkezo termek ide
     * esik. A stderr-en tehat egy tokeletesen egeszseges futas riasztasnak
     * latszana, minden egyes alkalommal.
     *
     * A testverparancs ugyanezt csinalja a maga hianyzo-sor esetevel
     * (`describeMissingStockRow`), es ugyanezert. A stderr ebben a parancsban
     * a valodi bukasoke: azok mind novelik a `failed` szamlalot is.
     */
    if (categories.kind === "incomplete")
      out.stdout(
        `${describeMissingCategoryMapping(product.id, categories.missing)}\n`,
      );

    /**
     * A MI MARKANK -> MEDUSA GYUJTEMENY.
     *
     * Ugyanaz a szerkezet, mint a kategorianal: itt csak a LEKERDEZES all, a
     * szabaly a `medusa-brand.policy.ts` modulban, mert ez a fuggveny a
     * `prisma`-t modul-szintu importbol veszi.
     *
     * A HIANY SORA A STDOUT-RA MEGY, ugyanabbol az okbol, mint a kategoriae: a
     * hianyzo lekepezes NEM bukas. A termek kimegy, csak gyujtemeny nelkul, es
     * amig a marka-gyujtemenyek betoltese nincs kesz, MINDEN markas termek ide
     * esik.
     */
    const brand = decideMedusaBrandCollection(
      product.brandId,
      product.brandId
        ? await prisma.externalReference.findMany({
            where: {
              ...MEDUSA_BRAND_REFERENCE,
              entityId: product.brandId,
            },
            select: { entityId: true, externalId: true },
          })
        : [],
    );
    if (brand.kind === "unmapped")
      out.stdout(
        `${describeMissingBrandMapping(product.id, brand.missingBrandId)}\n`,
      );

    /**
     * A KEPEK KIVITELE A VETITES ELE KERUL, ES EZ A SORREND KOTOTT: a vetites
     * BOLTI URL-eket var, azok pedig csak a feltoltes utan leteznek.
     *
     * A bukas ITT NEM allitja meg a termeket -- a `blockedBy` sor a jelentesbe
     * megy, es a vetites `null` kep-listaval fut le. Egy termek, aminek a nevet
     * javitottuk, attol meg frissuljon, hogy a kepei meg uton vannak.
     */
    /**
     * A VALTOZAT VONALKODJA, ES AZ ISMETLODES SZAMLALASA.
     *
     * A `manufacturerPartNumber` oszlop VEGYES: hol valodi gyartoi cikkszam
     * all benne, hol vonalkod. A szetvalasztas a `medusa-barcode.policy`
     * modulban all, adatbazis nelkul merhetoen; itt csak a LEKERDEZES van.
     *
     * AZ ISMETLODEST EGYEDUL A HIVO TUDJA MEGMONDANI: a vetites termekenkent
     * fut, tehat a policy nem lathatja, hany masik valtozaton all ugyanaz a
     * kod. Ezert szamoljuk meg itt, es adjuk at szamkent.
     *
     * A szamlalas AKTIV valtozatokra szol: egy inaktiv valtozat nem kerul ki a
     * boltba, tehat nem is utkozhet ott.
     */
    const nyersVonalkod = product.variants[0]?.manufacturerPartNumber ?? null;
    /**
     * EGY lekerdezes, es a szamot MEGTARTJUK a hiany-sorhoz is. Egy masodik
     * `count` ugyanarra az ertekre nem csak folosleges kor: ket kulonbozo
     * pillanatban futna, tehat a dontes es a rola szolo mondat MAS szamon
     * allhatna.
     */
    const azonosKodudarab = nyersVonalkod
      ? await prisma.productVariant.count({
          where: { manufacturerPartNumber: nyersVonalkod, isActive: true },
        })
      : 0;
    const vonalkod = decideMedusaBarcode(nyersVonalkod, azonosKodudarab);
    if (vonalkod.kind === "skipped") {
      kihagyottVonalkod += 1;
      out.stdout(
        `${describeSkippedBarcode(
          product.id,
          vonalkod.duplicate,
          azonosKodudarab,
        )}\n`,
      );
    }

    const futasIdeje = new Date();

    /**
     * A MESTER ELOSZOR, A FELTOLTES UTANA -- ES A SORREND NEM CSERELHETO FEL.
     *
     * A `publishProductImages` `storageKey` nelkuli kepet NEM tolt fel, hanem
     * megnevezi ("a kép még nincs áthozva a mesterbe"). Merve 2026-09-04: a
     * masolo meg volt irva, beolvasztva, es NULLA hivoja volt -- ezert allt a
     * mai reggeli naplo MINDEN termeknel ugyanaz a sor. Nem hiba volt: a masolo
     * soha nem futott le.
     *
     * CSAK AMI HIANYZIK. Aminek mar van kulcsa, azt nem hozzuk at ujra: a
     * masolo maga is felismeri (`alreadyStored`), de a szuressel a keres el sem
     * indul.
     */
    const mesterNelkul = product.images.filter(
      (image) => image.storageKey === null,
    );
    const masolas = mesterNelkul.length
      ? await copyProductImages(
          mesterNelkul.map((image) => ({
            id: image.id,
            productId: product.id,
            url: image.url,
          })),
          {
            fetchImpl: fetch,
            store: createDocumentStore(env),
            recordStorageKey: async (imageId, storageKey) => {
              await prisma.productImage.update({
                where: { id: imageId },
                data: { storageKey },
              });
            },
          },
        )
      : null;
    masoltKepek += masolas?.copied ?? 0;
    bukottKepek += masolas?.failed.length ?? 0;

    /**
     * A KULCSOKAT UJRA OLVASSUK, NEM SZAMOLJUK KI.
     *
     * A masolo a sorba irja a kulcsot, a memoriaban levo `product.images`
     * viszont a masolas ELOTTI allapotot hordozza. A kulcs helyi
     * ujraszarmaztatasa ugyanazt a lekepezest ismetelne meg egy masodik
     * helyen -- es a ket hely elcsuszhatna. Egy lekerdezes olcsobb, mint egy
     * nema elteres a tarolo-kulcsban.
     */
    const kepek = masolas
      ? await prisma.productImage.findMany({
          where: { id: { in: product.images.map((image) => image.id) } },
          select: { id: true, url: true, storageKey: true, fileName: true },
        })
      : product.images;

    const published = kepek.length
      ? await publishProductImages(
          product.id,
          kepek.map((image) => ({
            id: image.id,
            url: image.url,
            storageKey: image.storageKey,
            fileName: image.fileName ?? `${image.id}.jpg`,
            contentType: "image/jpeg",
          })),
          {
            store: createDocumentStore(env),
            medusa: imageClient!,
            links: imageLinks,
            /**
             * UGYANAZ AZ IDOPONT, mint amit a vetites kap -- ket kulon
             * `new Date()` ket kulonbozo masodpercet adna ugyanarra a
             * muveletre, es a ket lekepezes idobelyege elcsuszna egymastol.
             */
            now: futasIdeje,
          },
        )
      : null;
    if (published?.blockedBy)
      out.stdout(
        `${product.id}: a képek nem mentek ki (${published.blockedBy})\n`,
      );
    const publishedImageUrls = published?.urls.length ? published.urls : null;

    const outcome = await service!.project(
      {
        id: product.id,
        name: product.name,
        description: product.description,
        descriptionLong: product.descriptionLong,
        primarySku: product.variants[0]?.sku ?? null,
        medusaCategoryIds: categories.medusaCategoryIds,
        medusaCollectionId: brand.medusaCollectionId,
        barcode: vonalkod.field
          ? { field: vonalkod.field, value: vonalkod.value }
          : null,
        /**
         * A SZORZO ITT VALIK SZOVEGGE, es itt van a helye: a `Decimal` alak a
         * PRISMA tipusa, es a metaadat kulcs-ertek parokat tart. A vetites mar
         * nem tudna eldonteni, hany tizedes kell -- a `toString` a tarolt
         * pontossagot adja vissza, nem egy talalgatast.
         */
        ...projectValtozatMezok(product.variants[0]),
        ...projectRendelesiKorlatok(product.unasSnapshot),
        ...projectUnasChannelRow(product.channelListings[0]),
        /**
         * A KEPEK BOLTI URL-JEI, vagy `null`.
         *
         * A `null` NEM azt jelenti, hogy nincs kep: azt, hogy MOST nem tudunk
         * teljes listat adni (nincs meg a mester, serult a fajl, vagy elhasalt
         * a feltoltes). A vetites ilyenkor KIHAGYJA a mezot, tehat a boltban
         * mar kint levo kepek ERINTETLENUL maradnak.
         *
         * ES EZ PONTOSITAS A SAJAT KORABBI TERVEMHEZ KEPEST. Azt irtam, hogy a
         * termek KIMARAD a vetitesbol, ha a kepei nem mennek. Az tul szigoru:
         * akkor a NEV, a leiras es az allapot sem frissulne, holott azoknak
         * semmi kozuk a kepekhez. A helyes alak az, hogy a KEP-MEZO marad ki,
         * nem a termek.
         */
        images: publishedImageUrls,
        publication: {
          catalogAuthority: product.catalogAuthority,
          isActive: product.isActive,
          webshopSellable: product.webshopSellable,
          activeVariantCount: product.variants.length,
        },
      },
      futasIdeje,
    );

    if (outcome.action === "stopped") {
      out.stderr(
        `${productId}: MEGÁLLT (${outcome.reason}) ${outcome.details}\n`,
      );
      failed += 1;
      continue;
    }
    out.stdout(
      `${productId}: ${outcome.action} -> ${outcome.medusaProductId}\n` +
        `      ${describePublication(outcome.publication)}\n` +
        describeKepMasolas(masolas) +
        describeCimValtozas(outcome.cim),
    );
  }

  /**
   * A ZARO SOR CSAK AKKOR ALL KI, HA VOLT MIT KIZARNI.
   *
   * Egy allando "0 vonalkod kihagyva" sor minden futasban ott allna, es epp
   * attol nem venne eszre senki, amikor NEM nulla. A nulla eset nem hallgatas:
   * a termekenkenti sorok hianya mondja meg ugyanazt.
   */
  /**
   * A KEPEK ZARO SZAMA UGYANAZZAL A SZABALLYAL: csak ha volt mit mondani.
   * A bukas KULON all, mert a teendo mas -- a sor valtozatlan maradt, tehat a
   * kovetkezo futas ujra probalja, es addig latszania kell, hany var meg.
   */
  if (masoltKepek || bukottKepek)
    out.stdout(
      `${masoltKepek} kép mestere került át` +
        (bukottKepek
          ? `, ${bukottKepek} nem sikerült -- azok sora változatlan, a következő futás újra próbálja.\n`
          : ".\n"),
    );

  if (kihagyottVonalkod)
    out.stdout(
      `${kihagyottVonalkod} vonalkód maradt ki ismétlődés miatt. ` +
        `A tisztítás helye a forrás (UNAS): ott dől el, melyik terméké a kód.\n`,
    );

  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runProjectionCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
