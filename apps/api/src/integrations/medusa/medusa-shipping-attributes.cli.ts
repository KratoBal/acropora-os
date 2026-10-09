import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import { liveAnimalSubtreeIds } from "./medusa-livestock.policy.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";
import {
  listAllShopSkus,
  osSkuIndex,
  pairShopProducts,
} from "./medusa-sku-pairing.js";
import { unasShippingProfile } from "./medusa-unas-shipping.policy.js";

/**
 * A SZALLITASI JELLEMZOK ATVITELE A BOLTBA.
 *
 * === AZ ALAPERTELMEZES: A PROFILLAL RENDELKEZO TERMEKEK, ES CSAK TERV ===
 *
 * A halmazt nem a hivo sorolja fel, hanem az ADAT hatarozza meg: azok a
 * termekek, amelyeknek VAN szallitasi-jellemzo soruk. Egy profil-sor csak ugy
 * keletkezik, hogy valaki KEZZEL kitoltotte a termek lapjan -- tehat a halmaz
 * pontosan az, amit megvizsgaltak.
 *
 * Egy cikkszam- vagy azonosito-listat kerni ugyanezert lenne rossz: a hivonak
 * kellene tudnia, kit vizsgaltak meg, es az a tudas az adatbazisban all.
 *
 * === ES AZ IRAS KULON KAPCSOLO, MERT A BOLTBA IR ===
 *
 * `--apply` nelkul a parancs OLVAS es TERVET ir ki. Ez nem ovatoskodas: a regi
 * ertekeket az iras utan mar senki nem tudja visszaallitani, mert nem tudja,
 * mik voltak.
 */
export interface ShippingAttributesCliDatabase {
  /** A kategoria-fa, a szarmaztatott bolti atvetelhez. Egy lekerdezes. */
  category: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; name: string; parentId: string | null }[]>;
  };
  /** A besorolasok, CSAK az elo allat reszfara szurve. */
  productCategory: {
    findMany(
      args: unknown,
    ): Promise<{ productId: string; categoryId: string }[]>;
  };
  productShippingProfile: {
    findMany(args: unknown): Promise<
      {
        productId: string;
        pickupOnly: boolean;
        foxpostForbidden: boolean;
        isHeavy: boolean;
        isFrozen: boolean;
      }[]
    >;
  };
  /** Az OS változatok SKU-ja, a bolti termékek párosításához. */
  productVariant: {
    findMany(args: unknown): Promise<{ sku: string; productId: string }[]>;
  };
  /** A UNAS-tükör nyers válasza: a szállítási mód-felülírások forrása. */
  unasProductSnapshot: {
    findMany(
      args: unknown,
    ): Promise<{ productId: string; rawPayload: unknown }[]>;
  };
}

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function runShippingAttributesCli(
  argumentumok: string[],
  out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: ShippingAttributesCliDatabase = prisma as unknown as ShippingAttributesCliDatabase,
  service?: MedusaShippingAttributesService,
): Promise<number> {
  const apply = argumentumok.includes("--apply");
  const idk = argumentumok.filter((a) => !a.startsWith("--"));

  /**
   * A HALMAZ KET FORRASBOL AL OSSZE, ES A MASODIK AZ, AMI MA EGYALTALAN AD
   * ADATOT.
   *
   * profil-sor:      valaki KEZZEL megvizsgalta a terméket
   * elo allat ag:    a kategoria-fa mondja meg, hogy bolti atvetel jar
   *
   * A ket halmaz UNIOJA a cel. Ha csak a profil-sorokat neznenk, ma NULLA
   * termeket vinnenk at (merve: nulla profil-sor all az adatbazisban), es a
   * parancs helyesen mondana, hogy nincs mit tenni -- kozben 206 elo allat
   * termek maradna jeloletlen a boltban.
   */
  const kategoriak = await database.category.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const eloAllatIds = liveAnimalSubtreeIds(kategoriak);

  const besorolasok = eloAllatIds.size
    ? await database.productCategory.findMany({
        where: {
          categoryId: { in: [...eloAllatIds] },
          ...(idk.length ? { productId: { in: idk } } : {}),
        },
        select: { productId: true, categoryId: true },
      })
    : [];
  const eloAllatTermekek = new Set(besorolasok.map((sor) => sor.productId));

  const profilok = await database.productShippingProfile.findMany({
    where: idk.length ? { productId: { in: idk } } : {},
    select: {
      productId: true,
      pickupOnly: true,
      foxpostForbidden: true,
      isHeavy: true,
      isFrozen: true,
    },
    orderBy: { productId: "asc" },
  });

  /*
    A HARMADIK FORRAS: A UNAS SZALLITASI MOD-FELULIRASAI (kartya 2a7f2313,
    Balazs 2026-10-06 16:45 UTC, csak a teszt bolt). A KEZZEL kitoltott
    profil-sor ERŐSEBB: ahol van, a UNAS-bol jovo nem irja felul -- azt valaki
    megvizsgalta. Ez a parancs az OS-be NEM ir. A jelzok 2026-10-09 ota az
    OS-ben is elnek (a82ed229: a UNAS-szinkron es a kezi iras tartja oket), igy a
    UNAS-bol szamolt ertek itt mar csak a meg sor nelkuli termeknel dont.
  */
  const unasSorok = await database.unasProductSnapshot.findMany({
    where: idk.length ? { productId: { in: idk } } : {},
    select: { productId: true, rawPayload: true },
  });
  const unasProfilok = new Map(
    unasSorok.flatMap((sor) => {
      const profil = unasShippingProfile(sor.rawPayload);
      return profil
        ? [[sor.productId, { productId: sor.productId, ...profil }] as const]
        : [];
    }),
  );

  const profilPerTermek = new Map(profilok.map((p) => [p.productId, p]));
  const celok = [
    ...new Set([
      ...profilPerTermek.keys(),
      ...unasProfilok.keys(),
      ...eloAllatTermekek,
    ]),
  ].sort();

  if (celok.length === 0) {
    /**
     * A NULLA NEM HIBA, DE NEM IS NEMA: megmondjuk, MIT kerdeztunk. Enelkul a
     * kimenet ugyanugy nezne ki, mint egy elhasalt lekerdezes.
     */
    out.stdout(
      idk.length
        ? `A megadott termékek közül egyiknek sincs sem szállítási-jellemző sora, sem élő állat besorolása (${idk.length} azonosító).\n`
        : "Egyetlen terméknek sincs sem szállítási-jellemző sora, sem élő állat besorolása: nincs mit átvinni.\n",
    );
    return 0;
  }

  const csakUnas = [...unasProfilok.keys()].filter(
    (id) => !profilPerTermek.has(id),
  );
  out.stdout(
    `${celok.length} termék: ${profilPerTermek.size} kézzel kitöltött, ` +
      `${csakUnas.length} a UNAS szállítási felülírásából, ` +
      `${eloAllatTermekek.size} élő állat besorolás alapján.\n`,
  );

  let futtato = service;
  if (!futtato) {
    try {
      futtato = new MedusaShippingAttributesService(
        new MedusaProductLinkRepository(),
        await medusaClientForProjection(credentials, out),
      );
    } catch (error) {
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

  /*
    A KOTES-SOR NELKULI PAROSITAS SKU ALAPJAN (kartya 2a7f2313, mert
    2026-10-06): a teszt bolt 1492 termekebol egyiknek sincs ExternalReference
    kotese, es az external_id-juk egy korabbi OS-allapote (1/1492 egyezik). A
    bolti valtozatok SKU-ja az OS valtozat-SKU es a UNAS cikkszam ellen; CSAK
    az egyertelmu par szamit (minden SKU egy OS termekre mutat, es arra az OS
    termekre csak ez az egy bolti termek).
  */
  const parositas = await skuParositas(futtato, database);
  out.stdout(
    `SKU-párosítás: ${parositas.osToShop.size} egyértelmű, ${parositas.ketertelmu} kétértelmű, ${parositas.nincs} pár nélkül (a bolt ${parositas.boltiTermek} termékéből)\n`,
  );

  let bukott = 0;
  for (const productId of celok) {
    const profil =
      profilPerTermek.get(productId) ?? unasProfilok.get(productId) ?? null;
    const outcome = await futtato.project(
      productId,
      profil,
      apply,
      eloAllatTermekek.has(productId),
      parositas.osToShop.get(productId) ?? null,
    );
    switch (outcome.action) {
      case "skipped":
        out.stdout(
          `${productId}: kihagyva (${
            outcome.reason === "no-link"
              ? "még nincs a boltban"
              : "nincs profil-sora"
          })\n`,
        );
        break;
      case "unchanged":
        out.stdout(
          `${productId}: már így állt -> ${outcome.medusaProductId} (${outcome.flags})\n`,
        );
        break;
      case "planned":
        out.stdout(
          `${productId}: KIKÜLDENÉNK -> ${outcome.medusaProductId} (${outcome.flags})\n`,
        );
        break;
      case "applied":
        out.stdout(
          `${productId}: most állítottuk be -> ${outcome.medusaProductId} (${outcome.flags})\n`,
        );
        break;
    }
  }

  if (!apply)
    out.stdout(
      "\nEz a futás semmit nem írt. Az átvitelhez add meg a --apply kapcsolót.\n",
    );

  return bukott ? 1 : 0;
}

/**
 * OS termek -> bolti termek, csak az egyertelmu SKU-parok. A szabaly a
 * `medusa-sku-pairing.ts`-ben all, mert az osszekoto parancs is azt futtatja.
 */
export async function skuParositas(
  futtato: Pick<MedusaShippingAttributesService, "listShopSkus">,
  database: Pick<
    ShippingAttributesCliDatabase,
    "productVariant" | "unasProductSnapshot"
  >,
): Promise<{
  osToShop: Map<string, string>;
  ketertelmu: number;
  nincs: number;
  boltiTermek: number;
}> {
  const [valtozatok, tukrok] = await Promise.all([
    database.productVariant.findMany({
      select: { sku: true, productId: true },
    }),
    database.unasProductSnapshot.findMany({
      select: { productId: true, rawPayload: true },
    }),
  ]);
  const boltiak = await listAllShopSkus({
    listProductSkus: (offset, limit) => futtato.listShopSkus(offset, limit),
  });
  const dontesek = pairShopProducts(osSkuIndex(valtozatok, tukrok), boltiak);

  const osToShop = new Map<string, string>();
  let ketertelmu = 0;
  let nincs = 0;
  for (const dontes of dontesek) {
    if (dontes.kind === "pair")
      osToShop.set(dontes.osProductId, dontes.shopProductId);
    else if (dontes.kind === "no-match") nincs++;
    else ketertelmu++;
  }
  return { osToShop, ketertelmu, nincs, boltiTermek: boltiak.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runShippingAttributesCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
