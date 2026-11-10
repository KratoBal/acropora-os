import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  adoptPickup,
  describePickupAdoption,
  describeUnmarkedPickup,
  gatherUnmarkedPickup,
  parseReviewedIds,
  type PickupAdoptionDatabase,
  type PickupAdoptionService,
} from "./medusa-pickup-adoption.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import { type CliOutput } from "./medusa-shipping-attributes.cli.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/**
 * A MULTBELI MARADEK EGYSZERI LISTAJA ES ATNEZETT ATVETELE (kartya c603774e): a szabaly a `medusa-pickup-adoption.ts`-ben all.
 *
 *   medusa:pickup-adoption                          LISTA, csak olvas
 *   medusa:pickup-adoption --adopt <fajl>           TERV: mit jelolne a fajlban felsorolt OS-termekeken
 *   medusa:pickup-adoption --adopt <fajl> --apply   a jeloles, a boltba IR (a teszt boltba; eleshez Balazs kulon szava kell)
 *
 * A fajl soronkent egy OS-azonosito (az elso szo): a lista sorainak elso oszlopa, az atnezes utan. Amit nem soroltak fel, a parancs
 * nem erinti, es a fajlban felsorolt, de nem adoptalhato azonosito NEVET es okat kap a kimenetben.
 */
export type PickupAdoptionCliDatabase = PickupAdoptionDatabase;

export async function runPickupAdoptionCli(
  argumentumok: string[],
  out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: PickupAdoptionCliDatabase = prisma as unknown as PickupAdoptionCliDatabase,
  service?: MedusaShippingAttributesService & PickupAdoptionService,
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<number> {
  const apply = argumentumok.includes("--apply");
  const adoptAt = argumentumok.indexOf("--adopt");
  const file = adoptAt >= 0 ? argumentumok[adoptAt + 1] : undefined;
  if (adoptAt >= 0 && (!file || file.startsWith("--"))) {
    out.stderr("Az --adopt után az átnézett fájl útja kell.\n");
    return 2;
  }
  if (apply && adoptAt < 0) {
    out.stderr(
      "Az --apply csak az --adopt <fájl> mellett értelmes: a lista soha nem ír.\n",
    );
    return 2;
  }
  let reviewed: Set<string> | null = null;
  if (file) {
    try {
      reviewed = parseReviewedIds(await read(file));
    } catch (error) {
      out.stderr(
        `Az átnézett fájl nem olvasható: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
    if (!reviewed.size) {
      out.stderr(
        "Az átnézett fájlban nincs egyetlen azonosító sem: nincs mit adoptálni.\n",
      );
      return 2;
    }
  }

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
  const shipping = futtato;

  const report = await gatherUnmarkedPickup(shipping, database);
  out.stdout(describeUnmarkedPickup(report));
  if (!reviewed) return 0;
  if (!report.markKnown) return 1;

  const result = await adoptPickup(shipping, report, reviewed, apply);
  out.stdout(describePickupAdoption(result, apply));
  if (!apply)
    out.stdout(
      "\nEz a futás semmit nem írt. A jelöléshez add meg az --apply kapcsolót.\n",
    );
  return result.refused.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runPickupAdoptionCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
