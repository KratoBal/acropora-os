import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  MedusaConfigurationError,
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MEDUSA_PRODUCT_REFERENCE,
  MedusaProductLinkConflictError,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import {
  listAllShopSkus,
  osSkuIndex,
  pairShopProducts,
  type SkuPairDecision,
} from "./medusa-sku-pairing.js";

/**
 * A TESZT BOLT TERMÉKEINEK ÖSSZEKÖTÉSE AZ OS TERMÉKEKKEL, SKU ALAPJÁN.
 *
 * A teszt bolt termékei a UNAS-ból kerültek a Medusába, és az OS oldalon nincs
 * rájuk `ExternalReference` (MEDUSA / Product) kötés (mérve 2026-10-07: 2 sor a
 * 1492-ből). A készlet- és az árvetítés CSAK ezen a kötésen át találja meg a bolti
 * terméket, tehát kötés nélkül semmit nem visz ki. Ez a parancs egyszer kitölti.
 *
 * A KULCS AZ SKU (acrobot döntése, 2026-10-07 01:20 UTC): az `external_id` a
 * 09-25-i újratöltés előtti OS-azonosító, ma 1/1492 él. Nem feltétel, csak
 * eltérésként kerül a jelentésbe; a kötés utáni első termék-vetítés úgyis az új
 * OS-azonosítót írja rá.
 *
 * CSAK AZ OS-BE ÍR, a boltba semmit. `--apply` nélkül csak terv.
 *
 * A KÖTÉS IDEJE A FUTÁS KEZDETE, nem üres: üres `lastSyncedAt` mellett a
 * termék-ütemező minden kötött terméket esedékesnek látna, és a bolti nevet és
 * leírást az OS-ből felülírná. Így a tartalom csak forrásváltozásra mozdul.
 *
 * MEGLÉVŐ KÖTÉST NEM ÍR FELÜL: ha az OS termék vagy a bolti termék már máshoz
 * van kötve, az ütközés, és a jelentésben marad.
 */
export interface SkuLinkCliDatabase {
  productVariant: {
    findMany(args: unknown): Promise<{ sku: string; productId: string }[]>;
  };
  unasProductSnapshot: {
    findMany(
      args: unknown,
    ): Promise<{ productId: string; rawPayload: unknown }[]>;
  };
  externalReference: {
    findMany(
      args: unknown,
    ): Promise<{ entityId: string; externalId: string }[]>;
  };
}

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export type SkuLinkOutcome =
  | "linked"
  | "planned"
  | "already-linked"
  | "conflict"
  | "ambiguous-sku"
  | "no-match"
  | "shared-os-product";

const OUTCOME_LABELS: Record<SkuLinkOutcome, string> = {
  linked: "most kötve",
  planned: "kötnénk",
  "already-linked": "már így volt kötve",
  conflict: "ütközik egy meglévő kötéssel",
  "ambiguous-sku": "az SKU több OS termékre mutat",
  "no-match": "az SKU nem ismert az OS-ben",
  "shared-os-product": "több bolti termék mutat ugyanarra az OS termékre",
};

/**
 * A döntés egy párra a meglévő kötésekhez mérve. Tiszta függvény: a kötések
 * mindkét irányban (OS -> bolt, bolt -> OS) a hívótól jönnek.
 */
export function linkOutcome(
  pair: Extract<SkuPairDecision, { kind: "pair" }>,
  byOs: ReadonlyMap<string, string>,
  byShop: ReadonlyMap<string, string>,
): "already-linked" | "conflict" | "new" {
  const shopOfOs = byOs.get(pair.osProductId);
  const osOfShop = byShop.get(pair.shopProductId);
  if (shopOfOs === pair.shopProductId && osOfShop === pair.osProductId)
    return "already-linked";
  if (shopOfOs !== undefined || osOfShop !== undefined) return "conflict";
  return "new";
}

export async function runSkuLinkCli(
  argumentumok: string[],
  out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: SkuLinkCliDatabase = prisma as unknown as SkuLinkCliDatabase,
  deps: {
    shop?: Pick<MedusaAdminClient, "listProductSkus">;
    links?: Pick<MedusaProductLinkRepository, "link">;
    now?: () => Date;
  } = {},
): Promise<number> {
  const ismeretlen = argumentumok.filter((a) => a !== "--apply");
  if (ismeretlen.length) {
    out.stderr(
      `Ismeretlen argumentum: ${ismeretlen.join(" ")}. Egyetlen kapcsoló van: --apply.\n`,
    );
    return 1;
  }
  const apply = argumentumok.includes("--apply");
  const syncedAt = (deps.now ?? (() => new Date()))();

  let shop = deps.shop;
  if (!shop) {
    try {
      shop = await medusaClientForProjection(credentials, out);
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
  const links = deps.links ?? new MedusaProductLinkRepository();

  const [valtozatok, tukrok, kotesek, boltiak] = await Promise.all([
    database.productVariant.findMany({
      select: { sku: true, productId: true },
    }),
    database.unasProductSnapshot.findMany({
      select: { productId: true, rawPayload: true },
    }),
    database.externalReference.findMany({
      where: { ...MEDUSA_PRODUCT_REFERENCE },
      select: { entityId: true, externalId: true },
    }),
    listAllShopSkus(shop),
  ]);

  /**
   * A NULLA MELLÉ A KONTROLL: üres OS katalógus vagy üres bolt mellett minden
   * termék "nem ismert" lenne, ami pontosan úgy nézne ki, mint egy rossz
   * párosítás. Ilyenkor megállunk, és megmondjuk, melyik oldal üres.
   */
  if (!valtozatok.length || !boltiak.length) {
    out.stderr(
      `Nincs mit párosítani: ${valtozatok.length} OS változat, ${boltiak.length} bolti termék. ` +
        `Az egyik oldal üres, ez nem párosítási eredmény.\n`,
    );
    return 1;
  }

  const byOs = new Map(kotesek.map((k) => [k.entityId, k.externalId]));
  const byShop = new Map(kotesek.map((k) => [k.externalId, k.entityId]));
  const dontesek = pairShopProducts(osSkuIndex(valtozatok, tukrok), boltiak);

  const counts = new Map<SkuLinkOutcome, number>();
  const bump = (outcome: SkuLinkOutcome) =>
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  const reszletek: string[] = [];
  let externalIdEgyezik = 0;
  let externalIdElavult = 0;
  let externalIdUres = 0;
  let hibak = 0;

  for (const dontes of dontesek) {
    if (dontes.kind !== "pair") {
      bump(dontes.kind);
      reszletek.push(
        dontes.kind === "no-match"
          ? `${dontes.shopProductId} (sku: ${dontes.skus.join(", ") || "nincs"}): ${OUTCOME_LABELS[dontes.kind]}`
          : dontes.kind === "ambiguous-sku"
            ? `${dontes.shopProductId}: ${OUTCOME_LABELS[dontes.kind]} (${dontes.osProductIds.join(", ")})`
            : `${dontes.shopProductId}: ${OUTCOME_LABELS[dontes.kind]} (${dontes.osProductId})`,
      );
      continue;
    }

    if (!dontes.externalId) externalIdUres++;
    else if (dontes.externalId === dontes.osProductId) externalIdEgyezik++;
    else externalIdElavult++;

    const allapot = linkOutcome(dontes, byOs, byShop);
    if (allapot === "already-linked") {
      bump("already-linked");
      continue;
    }
    if (allapot === "conflict") {
      bump("conflict");
      reszletek.push(
        `${dontes.shopProductId} -> ${dontes.osProductId}: ${OUTCOME_LABELS.conflict} ` +
          `(az OS termék kötése: ${byOs.get(dontes.osProductId) ?? "nincs"}, ` +
          `a bolti termék kötése: ${byShop.get(dontes.shopProductId) ?? "nincs"})`,
      );
      continue;
    }
    if (!apply) {
      bump("planned");
      continue;
    }
    try {
      await links.link(dontes.osProductId, dontes.shopProductId, syncedAt);
      bump("linked");
    } catch (error) {
      if (error instanceof MedusaProductLinkConflictError) {
        bump("conflict");
        reszletek.push(
          `${dontes.shopProductId} -> ${dontes.osProductId}: ${OUTCOME_LABELS.conflict} (írás közben)`,
        );
        continue;
      }
      hibak++;
      out.stderr(
        `${dontes.shopProductId} -> ${dontes.osProductId}: a kötés írása elhasalt: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }

  out.stdout(
    `A bolt ${boltiak.length} terméke, az OS ${new Set(valtozatok.map((v) => v.productId)).size} terméke ` +
      `(${valtozatok.length} változat), ${kotesek.length} meglévő kötés.\n`,
  );
  for (const outcome of Object.keys(OUTCOME_LABELS) as SkuLinkOutcome[])
    if (counts.get(outcome))
      out.stdout(`  ${OUTCOME_LABELS[outcome]}: ${counts.get(outcome)}\n`);
  out.stdout(
    `A párok external_id-ja: ${externalIdEgyezik} egyezik az OS termékkel, ` +
      `${externalIdElavult} régi OS-állapoté, ${externalIdUres} üres. ` +
      `Nem feltétel: a kötés utáni első termék-vetítés felülírja.\n`,
  );
  if (reszletek.length) {
    out.stdout(`\nNem kötött tételek (${reszletek.length}):\n`);
    for (const sor of reszletek) out.stdout(`  ${sor}\n`);
  }
  if (!apply)
    out.stdout(
      "\nEz a futás semmit nem írt. A kötéshez add meg a --apply kapcsolót.\n",
    );
  return hibak ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runSkuLinkCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
