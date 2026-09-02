import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  decideMedusaCategories,
  describeMissingCategoryMapping,
} from "./medusa-category.policy.js";
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
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaProductProjectionService,
  type ProjectionPublicationReport,
} from "./medusa-product-projection.service.js";
import { storefrontSalesChannelId } from "./medusa-sales-channel.config.js";

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
  const forgetOnly = productIds.includes("--forget-link");
  const targets = productIds.filter((value) => value !== "--forget-link");

  if (!targets.length) {
    out.stderr("Adj meg legalább egy termékazonosítót vagy sku: alakot.\n");
    return 1;
  }

  let service: MedusaProductProjectionService | null = null;
  if (!forgetOnly) {
    try {
      service = new MedusaProductProjectionService(
        new MedusaProductLinkRepository(),
        await medusaClientForProjection(credentials, out),
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
        catalogAuthority: true,
        isActive: true,
        webshopSellable: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { sku: true },
        },
        categories: { select: { categoryId: true } },
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
          system: "MEDUSA",
          entityType: "Product",
          entityId: product.id,
        },
      });
      out.stdout(
        `${product.id}: leképezés törölve (${removed.count} sor). A termék érintetlen.\n`,
      );
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
              system: "MEDUSA",
              entityType: "Category",
              entityId: { in: osCategoryIds },
            },
            select: { entityId: true, externalId: true },
          })
        : [],
    );
    if (categories.kind === "incomplete")
      out.stderr(
        `${describeMissingCategoryMapping(product.id, categories.missing)}\n`,
      );

    const outcome = await service!.project(
      {
        id: product.id,
        name: product.name,
        description: product.description,
        primarySku: product.variants[0]?.sku ?? null,
        medusaCategoryIds: categories.medusaCategoryIds,
        publication: {
          catalogAuthority: product.catalogAuthority,
          isActive: product.isActive,
          webshopSellable: product.webshopSellable,
          activeVariantCount: product.variants.length,
        },
      },
      new Date(),
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
