import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  decideMedusaCategories,
  describeMissingCategoryMapping,
  MEDUSA_CATEGORY_REFERENCE,
} from "./medusa-category.policy.js";
import {
  decideMedusaBrandCollection,
  describeMissingBrandMapping,
  MEDUSA_BRAND_REFERENCE,
} from "./medusa-brand.policy.js";
import { isKnownCatalogAuthority } from "./medusa-publication.policy.js";

import {
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
      throw error;
    }
  }

  let failed = 0;
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
          select: { sku: true },
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
          select: { slug: true, seoRobots: true },
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
    const futasIdeje = new Date();
    const published = product.images.length
      ? await publishProductImages(
          product.id,
          product.images.map((image) => ({
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
        slug: product.channelListings[0]?.slug ?? null,
        seoRobots: product.channelListings[0]?.seoRobots ?? null,
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
        `      ${describePublication(outcome.publication)}\n`,
    );
  }

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
