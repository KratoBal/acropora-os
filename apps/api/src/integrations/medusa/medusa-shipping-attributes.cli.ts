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
import {
  deriveLivestockKind,
  liveAnimalKindSubtrees,
  liveAnimalSubtreeIds,
} from "./medusa-livestock.policy.js";
import { rowsCarryingKind } from "./medusa-shipping-attributes.policy.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";
import {
  listAllShopSkus,
  osSkuIndex,
  pairShopProducts,
} from "./medusa-sku-pairing.js";

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
        lockerUnsuitable: boolean;
      }[]
    >;
  };
  /** Az OS változatok SKU-ja, a bolti termékek párosításához. */
  productVariant: {
    findMany(args: unknown): Promise<{ sku: string; productId: string }[]>;
  };
  /** A UNAS-tükör: a SKU-párosítás forrása (a cikkszám), és a sor nélküli UNAS-termékek száma. */
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
  // az elo allat FAJTAJA (V2.6): ugyanazokbol a besorolasokbol, tobb gyoker alatt allo termeknel null
  const fajtaReszfak = liveAnimalKindSubtrees(kategoriak);
  const besorolasPerTermek = new Map<string, string[]>();
  for (const sor of besorolasok)
    besorolasPerTermek.set(sor.productId, [
      ...(besorolasPerTermek.get(sor.productId) ?? []),
      sor.categoryId,
    ]);

  const profilok = await database.productShippingProfile.findMany({
    where: idk.length ? { productId: { in: idk } } : {},
    select: {
      productId: true,
      pickupOnly: true,
      foxpostForbidden: true,
      isHeavy: true,
      isFrozen: true,
      lockerUnsuitable: true,
    },
    orderBy: { productId: "asc" },
  });

  /*
    A JELZOK FORRASA AZ OS-SOR, ES CSAK AZ (a82ed229). A UNAS-szinkron a snapshot
    irasa utan a sort is irja, a kezi iras is, es az egyszeri feltolto (eles
    futas 2026-11-05) minden UNAS-termeknek adott sort. A UNAS nyers adatabol
    szamolt tartalek ezert nem dont tobbe semmirol; ha megis marad UNAS-termek
    sor nelkul, azt nem csendben potoljuk, hanem kimondjuk, hogy a feltolto
    hianyzik nala. A snapshotbol itt mar csak az azonosito kell ehhez.
  */
  const unasSorok = await database.unasProductSnapshot.findMany({
    where: idk.length ? { productId: { in: idk } } : {},
    select: { productId: true },
  });

  const profilPerTermek = new Map(profilok.map((p) => [p.productId, p]));
  const celok = [
    ...new Set([...profilPerTermek.keys(), ...eloAllatTermekek]),
  ].sort();
  const sorNelkuliUnas = unasSorok.filter(
    (sor) => !profilPerTermek.has(sor.productId),
  ).length;
  // a nulla cel-szam elott is: a sor nelkuli UNAS-termek epp ilyenkor marad rejtve
  if (sorNelkuliUnas)
    out.stdout(
      `FIGYELEM: ${sorNelkuliUnas} UNAS-terméknek nincs szállítási-jellemző sora; a jelzőit nem visszük át, előbb a feltöltő (shipping-profile:fill) kell.\n`,
    );

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

  out.stdout(
    `${celok.length} termék: ${profilPerTermek.size} szállítási-jellemző sorral, ` +
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
    const profil = profilPerTermek.get(productId) ?? null;
    const outcome = await futtato.project(
      productId,
      profil,
      apply,
      eloAllatTermekek.has(productId),
      parositas.osToShop.get(productId) ?? null,
      deriveLivestockKind(
        besorolasPerTermek.get(productId) ?? [],
        fajtaReszfak,
      ),
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

  /*
    A BOLTBAN MARADT FAJTA (kartya 4b30b373): egy termek, ami kikerult az elo allat kategoriabol, es nincs
    profil-sora, nem celpont fent, ezert a boltban a regi `livestock_kind` maradna. A bolti sorokbol keressuk.
  */
  await clearLeftoverKinds(
    futtato,
    new Set(celok),
    parositas.osToShop,
    idk,
    apply,
    out,
  );

  if (!apply)
    out.stdout(
      "\nEz a futás semmit nem írt. Az átvitelhez add meg a --apply kapcsolót.\n",
    );

  return bukott ? 1 : 0;
}

/**
 * A BOLTBAN MARADT ELO ALLAT FAJTA LETORLESE (V2.6 S1b koveto, kartya 4b30b373).
 *
 * A bolt sorai kozul azokat nezi, amelyeken fajta all, es amelyek OS-termeke NEM celpont a fo koron (nincs profil-sora
 * es nincs elo allat besorolasa): az OS mar nem vezeti le a fajtat, ezert a bolt sora null-t kap. Amelyik OS-termek
 * celpont volt, azt a fo kor mar a levezetett fajtaval irta (vagy mar igy allt). Amelyik bolti sorhoz nem talalunk OS-
 * termeket (sem kotes-sor, sem egyertelmu SKU-par), ahhoz nem nyulunk, csak megszamoljuk.
 */
export async function clearLeftoverKinds(
  futtato: Pick<
    MedusaShippingAttributesService,
    "listShopShippingAttributes" | "osProductOfShop" | "clearLeftoverKind"
  >,
  celok: ReadonlySet<string>,
  osToShop: ReadonlyMap<string, string>,
  idk: readonly string[],
  apply: boolean,
  out: CliOutput,
): Promise<{
  rows: number;
  carrying: number;
  cleared: number;
  unpaired: number;
}> {
  const rows = await futtato.listShopShippingAttributes();
  const carrying = rowsCarryingKind(rows);
  const shopToOs = new Map<string, string>(
    [...osToShop].map(([os, shop]) => [shop, os]),
  );
  let cleared = 0;
  let unpaired = 0;
  for (const row of carrying) {
    const osId =
      (await futtato.osProductOfShop(row.product_id)) ??
      shopToOs.get(row.product_id) ??
      null;
    if (!osId) {
      unpaired++;
      continue;
    }
    if (celok.has(osId)) continue;
    if (idk.length && !idk.includes(osId)) continue;
    const outcome = await futtato.clearLeftoverKind(row, apply);
    cleared++;
    out.stdout(
      `${osId}: ${
        outcome.action === "applied" ? "most állítottuk be" : "KIKÜLDENÉNK"
      } -> ${outcome.medusaProductId} (${outcome.flags})\n`,
    );
  }
  out.stdout(
    `Boltban maradt élő állat fajta: a bolt ${rows.length} szállítási-jellemző sort adott, ${carrying.length}-n áll fajta, ` +
      `${cleared} ${apply ? "törölve" : "törlendő"}, ${unpaired} OS-termék nélkül (nem nyúltunk hozzá).\n`,
  );
  return { rows: rows.length, carrying: carrying.length, cleared, unpaired };
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
