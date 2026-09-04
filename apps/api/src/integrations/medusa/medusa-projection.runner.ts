/**
 * A VETITES FUTTATOJA: a parancs TORZSE, a belepesi pontja nelkul.
 *
 * MIERT KULON MODUL. A `medusa-projection.cli.ts` ket dolgot csinalt egyszerre:
 * volt egy belepesi pontja (`process.argv`, `$disconnect`, `process.exit`) es
 * egy hatszaz soros torzse. Az elso CSAK parancssorbol hivhato; a masodikat az
 * utemezonek is hivnia kell majd. Amig egy fajlban alltak, a torzs orokolte a
 * belepesi pont korlatait.
 *
 * A SOROK BETURE VALTOZATLANOK, es ezt nem allitom, hanem MERTEM:
 * `agents/nautilus/scripts/mozgatas-azonos.sh` a regi es az uj tartomanyt
 * sorhalmazkent veti ossze, es a kulonbseg tetelesen all a PR torzseben.
 */
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
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import {
  MEDUSA_PRODUCT_REFERENCE,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectionPublicationReport,
} from "./medusa-product-projection.service.js";
import {
  MEDUSA_STOREFRONT_SALES_CHANNEL_ENV,
  storefrontSalesChannelId,
} from "./medusa-sales-channel.config.js";
import { createDocumentStore } from "../../service-assets/document-store/document-store.provider.js";
import { MedusaImageLinkRepository } from "./medusa-image-link.repository.js";
import {
  parseBatchArguments,
  selectBatchTargets,
} from "./medusa-projection-batch.js";
import { copyProductImages } from "./product-image-copier.js";
import { publishProductImages } from "./product-image-publisher.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";

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
 * KULON FUGGVENY, ES EZ MERESI KERDES, NEM STILUS. Egy tiszta fuggveny allitasa
 * NEV SZERINT tud pirosodni; a torzsbe irt lekepezes rontasa csak akkor, ha a
 * torzs-teszt eppen azt a mezot nezi.
 *
 * AZ EREDETI INDOKOM AZOTA ELAVULT, ES AZ EN SAJAT VALTOZASOM MIATT. Ez a
 * bekezdes korabban azt mondta, hogy a torzs a `prisma`-t MODUL-SZINTU importbol
 * veszi, tehat eles adatbazis nelkul nem merheto. A `db` parameter (2026-09-04)
 * ezt megszuntette: a torzs MA MERHETO. A kovetkeztetes valtozatlan, az OKA mas
 * -- es egy megjegyzes, ami egy azota bezart lyukat ir le, rosszabb a semminel.
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
 * UGYANAZ AZ OK, MINT A CSATORNA-SORNAL: egy tiszta fuggveny allitasa nev
 * szerint pirosodik. A kalibracio elso koreben a torzsbe irt lekepezes rontasa
 * NULLA allitast dontott pirosra -- akkor azert, mert a torzs merhetetlen volt,
 * ma azert, mert a torzs-teszt a fo utat jarja, nem minden mezot.
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
 * es a csatorna-sor lekepezese: a torzsbe irt lekepezes rontasara csak akkor
 * szolna valami, ha a torzs-teszt eppen ezt a harom mezot nezne -- es nem nezi.
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
 * A leiro fuggvenyek (`describeSkuLookupFailure`, `describePublication`) mind
 * kulon allnak, hogy a MONDATUK nev szerint merheto legyen. A torzs maga a `db`
 * parameter ota merheto (2026-09-04), de egy torzs-allitas a TELJES lancot
 * futtatja: a szoveg elirasat egy sajat allitas olcsobban fogja meg.
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

/**
 * AZ ADATBAZIS-HOZZAFERES, MINT PARAMETER -- ES EZ A HARMADIK PARAMETER
 * MINTAJANAK FOLYTATASA, NEM UJ TALALMANY.
 *
 * A `credentials` melletti megjegyzes szo szerint azt mondja: "Parameter, hogy
 * adatbazis nelkul is merheto legyen". Ugyanez az ok all itt is, egy szinttel
 * lejjebb: a torzs `prisma`-t hasznal MODUL-SZINTU importbol, tehat a benne allo
 * 304 sor erdemi kodot ma egyetlen teszt sem tudja lefuttatni.
 *
 * MIERT NEM MODUL-MOCKOLAS: merve (2026-09-04) a `mock.module` ezen a futtaton
 * NEM elerheto (kiserleti kapcsolot var, es a teszt-parancs nem adja meg), es a
 * repo sehol nem hasznalja. A bevezetese a teszt-parancsot valtoztatna meg, ami
 * az EGESZ csomag futtatasat erinti.
 *
 * AZ ALAPERTELMEZES A MAI VISELKEDES: minden mai hivo ugyanazt a `prisma`
 * peldanyt kapja, amit eddig.
 *
 * A TIPUS A VALODI SZERZODES RESZHALMAZA (`Pick<typeof prisma, ...>`), nem egy
 * kezzel irt interfesz. Az elso valtozat kezzel irt alakot hasznalt `unknown`
 * visszateressel, es a FORDITO fogta meg: a torzs a `webshopSellable` es a
 * `variants` mezot olvassa a talalatbol, tehat a laza tipus nem irja le a
 * hasznalatot. A `Pick` a Prisma sajat tipusat viszi tovabb, igy a torzs minden
 * mezo-hivatkozasa ellenorzott marad.
 */
export type ProjectionDatabase = Pick<
  typeof prisma,
  "product" | "externalReference" | "productVariant" | "productImage"
>;

export async function runProjectionCli(
  productIds: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  /** A hitelesítő adat útja. Paraméter, hogy adatbázis nélkül is mérhető legyen. */
  credentials: MedusaCredentialProvider = storedCredentialProvider(),
  env: Record<string, string | undefined> = process.env,
  db: ProjectionDatabase = prisma as unknown as ProjectionDatabase,
  /**
   * A HALOZATI HIVAS UTJA, ES EZ IS A REPO SAJAT MINTAJA: a
   * `medusaClientForProjection` MAR FOGAD `fetchImpl` parametert, es a
   * `medusa-admin.client.spec.ts` pontosan igy meri a klienst -- nem globalis
   * `fetch` felulirassal, hanem atadassal.
   *
   * `undefined` eseten a kliens a globalis `fetch` fuggvenyt hasznalja, tehat a
   * mai viselkedes valtozatlan.
   */
  fetchImpl?: typeof fetch,
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
  const { forgetOnly, from } = parsed.selection;

  /**
   * A HARMADIK KORAI KILEPES: A CSATORNA-AZONOSITO HIANYA.
   *
   * A ket masik konfiguracios kilepes (a hitelesito adat es a cim hianya) a
   * lenti `catch` agban all, es a komment ott ki is mondja, miert kap kulon
   * sort a ketto: mas a teendo. Ez a harmadik pontosan oda tartozik, csak
   * eddig NEM allt meg -- a hiany a szolgaltatasban derult ki, TERMEKENKENT.
   *
   * MERVE 2026-09-04: egy futasban huszonket azonos megallas keletkezett
   * (`sales-channel-not-configured`), egyetlen okra. A vetites aznap negyszer
   * futott, es minden korben at kellett olvasni azt a huszonketto sort, hogy
   * megtalaljuk az EGY valodi okot. A megallas maga helyes es nevesitett --
   * csak huszonketszer all elo ott, ahol egyszer kellene, MIELOTT barmi
   * elindul.
   *
   * AMIT EZ NEM CSINAL, es ezt ki kell mondani: nem potolja a hianyzo
   * erteket, es egy mar elindult futast nem javit meg. Csak annyit valtoztat,
   * hogy a kovetkezo ilyen esetben EGY sorbol kiderul, mit kell beallitani.
   *
   * ES A TERMEKENKENTI MEGALLAS MARAD. Nem ez valtja ki: a szolgaltatast mas
   * hivo is hasznalhatja, es egy belso orzo, amit egy kulso orzo "feleslegesse
   * tesz", pontosan addig felesleges, amig valaki egy masodik hivot nem ir.
   */
  if (!forgetOnly && storefrontSalesChannelId(env) === null) {
    out.stderr(
      `Nincs beállítva a ${MEDUSA_STOREFRONT_SALES_CHANNEL_ENV} ` +
        `környezeti változó, ezért egyetlen termék sem vetíthető: ` +
        `csatorna-kötés nélkül a vetítés félkész állapotot hagyna. ` +
        `Az érték KÖRNYEZETENKÉNT más -- a stage csatornája az élesen nem ` +
        `létezik, tehát nem örökölhető át. Nem küldtünk semmit.\n`,
    );
    return 1;
  }

  /**
   * A KOTEG STABIL RENDEZESSEL JON, es ez nem kozmetika: a `--from` egy adott
   * ponttol folytat, es egy rendezetlen lekerdezes minden futasnal MAS ablakot
   * adna -- ugyanaz a parancs ketszer futtatva termekeket hagyna ki es
   * ismetelne, csendben.
   *
   * A `gt` (nem `gte`) azert kell, mert a `--from` a MAR MEGVOLT utolso
   * azonosito: azt nem akarjuk megegyszer.
   */
  const targets = await selectBatchTargets(parsed.selection, db);

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
  /**
   * A KET LINK-TARHOZ IS A PARAMETERKENT KAPOTT ADATBAZIS MEGY.
   *
   * Mindketto konstruktora OPCIONALIS adatbazist fogad, es hianyaban a
   * modul-szintu `prisma` peldanyra esik vissza -- vagyis eddig a torzs
   * megkerulte a sajat parameteret. A mai viselkedes valtozatlan: az
   * alapertelmezett `db` maga a `prisma`.
   */
  const imageLinks = new MedusaImageLinkRepository(
    db as unknown as ConstructorParameters<typeof MedusaImageLinkRepository>[0],
  );
  if (!forgetOnly) {
    try {
      imageClient = await medusaClientForProjection(
        credentials,
        out,
        env,
        fetchImpl,
      );
      service = new MedusaProductProjectionService(
        new MedusaProductLinkRepository(
          db as unknown as ConstructorParameters<
            typeof MedusaProductLinkRepository
          >[0],
        ),
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

    const product = await db.product.findUnique({
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
            /**
             * A UNAS KOMBINACIO, amibol a bolti opcio-blokk kepzodik.
             *
             * A SORREND SZAMIT, es ezert marad az `orderBy` valtozatlan: a
             * tengelyek egyezeset a lista POZICIO szerint vetjuk ossze, es a
             * bolti opcio-ertekek is ebben a sorrendben allnak elo.
             */
            unasVariantValues: true,
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
      const removed = await db.externalReference.deleteMany({
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
     * modulban, hogy nev szerint merheto legyen. (A `db` parameter ota a torzs
     * is merheto, de a szabaly kulon allitasa ettol nem lett folosleges.)
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
        ? await db.externalReference.findMany({
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
     * szabaly a `medusa-brand.policy.ts` modulban, hogy nev szerint merheto
     * legyen.
     *
     * A HIANY SORA A STDOUT-RA MEGY, ugyanabbol az okbol, mint a kategoriae: a
     * hianyzo lekepezes NEM bukas. A termek kimegy, csak gyujtemeny nelkul, es
     * amig a marka-gyujtemenyek betoltese nincs kesz, MINDEN markas termek ide
     * esik.
     */
    const brand = decideMedusaBrandCollection(
      product.brandId,
      product.brandId
        ? await db.externalReference.findMany({
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
      ? await db.productVariant.count({
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
            /**
             * UGYANAZ A PARAMETER, MINT A MEDUSA KLIENSNEL. A masolo `fetch`-e
             * eddig a GLOBALIS peldany volt, tehat a hatodik parameter idaig
             * nem ert el -- es a masolo ag halozat nelkul merhetetlen maradt.
             *
             * A MAI VISELKEDES VALTOZATLAN: `fetchImpl` hianyaban ugyanaz a
             * globalis `fetch` all itt, ami eddig.
             */
            fetchImpl: fetchImpl ?? fetch,
            store: createDocumentStore(env),
            recordStorageKey: async (imageId, storageKey) => {
              await db.productImage.update({
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
      ? await db.productImage.findMany({
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
        /**
         * MIND AZ AKTIV VALTOZAT, es nem csak az elso.
         *
         * A lekepezes szabalya a `medusa-variant-options.ts`-ben all, tiszta
         * fuggvenyben; ide csak a nyers sorok kerulnek. Ugyanaz az indok, mint
         * a publikacios allapotnal: a hivo ne dontson helyette.
         */
        variantRows: product.variants.map((variant) => ({
          sku: variant.sku,
          unasVariantValues: variant.unasVariantValues,
        })),
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
