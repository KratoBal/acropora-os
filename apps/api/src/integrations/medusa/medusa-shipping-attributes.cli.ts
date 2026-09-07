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
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

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

  if (profilok.length === 0) {
    /**
     * A NULLA NEM HIBA, DE NEM IS NEMA: megmondjuk, MIT kerdeztunk. Enelkul a
     * kimenet ugyanugy nezne ki, mint egy elhasalt lekerdezes.
     */
    out.stdout(
      idk.length
        ? `Egyetlen megadott terméknek sincs szállítási-jellemző sora (${idk.length} azonosító).\n`
        : "Egyetlen terméknek sincs szállítási-jellemző sora: nincs mit átvinni.\n",
    );
    return 0;
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

  let bukott = 0;
  for (const profil of profilok) {
    const outcome = await futtato.project(profil.productId, profil, apply);
    switch (outcome.action) {
      case "skipped":
        out.stdout(
          `${profil.productId}: kihagyva (${
            outcome.reason === "no-link"
              ? "még nincs a boltban"
              : "nincs profil-sora"
          })\n`,
        );
        break;
      case "unchanged":
        out.stdout(
          `${profil.productId}: már így állt -> ${outcome.medusaProductId} (${outcome.flags})\n`,
        );
        break;
      case "planned":
        out.stdout(
          `${profil.productId}: KIKÜLDENÉNK -> ${outcome.medusaProductId} (${outcome.flags})\n`,
        );
        break;
      case "applied":
        out.stdout(
          `${profil.productId}: most állítottuk be -> ${outcome.medusaProductId} (${outcome.flags})\n`,
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runShippingAttributesCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
