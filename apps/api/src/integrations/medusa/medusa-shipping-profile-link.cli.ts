import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";

/**
 * MINDEN BOLTI TERMÉK AZ ALAPÉRTELMEZETT SZÁLLÍTÁSI PROFILHOZ (kártya 2a7f2313).
 *
 * Mérve: a teszt bolt 1502 termékéből egyiknek sincs szállítási profilja, és a
 * Medusa ilyen terméket tartalmazó rendelést nem zár le. A commerce seedje
 * minden szállítási módot EGY profilra tesz (a bolt alapértelmezettjére), tehát
 * a kötés nem termék-tulajdonság, hanem egyetlen helyes érték mindenkinek. A
 * szállítási OSZTÁLYT (bolti átvétel, nehéz, Foxpost tiltva) nem ez adja, hanem
 * a `medusa:shipping-attributes`.
 *
 * ALAPBÓL SZÁRAZ: lapozva végigmegy a bolt termékein, és megszámolja, hánynak
 * hiányzik vagy más a profilja. `--apply`-jal beállítja, és az ELSŐ írás után
 * VISSZAOLVASSA: ha a visszaolvasás nem látja a profilt, MEGÁLL. Ez a kontroll
 * nem díszlet: ha a lekérdezés mező-alakja rossz (`*shipping_profile`), a
 * válasz 200 és üres, és minden termék hiányzónak látszana -- az első
 * visszaolvasás ezt kimondja, mielőtt 1500 írás menne ki vakon.
 */
export interface ProfileLinkOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function runShippingProfileLink(
  apply: boolean,
  client: Pick<
    MedusaAdminClient,
    | "defaultShippingProfileId"
    | "listProductShippingProfiles"
    | "productShippingProfileId"
    | "setProductShippingProfile"
  >,
  out: ProfileLinkOutput,
  pageSize = 100,
): Promise<number> {
  const profileId = await client.defaultShippingProfileId();
  if (!profileId) {
    out.stderr(
      "MEGÁLL: a boltban nem pontosan EGY alapértelmezett szállítási profil áll, nem választok.\n",
    );
    return 1;
  }
  let offset = 0;
  let total = 0;
  const missing: string[] = [];
  let other = 0;
  for (;;) {
    const page = await client.listProductShippingProfiles(offset, pageSize);
    total = page.count;
    for (const product of page.products) {
      const current = product.shipping_profile?.id ?? null;
      if (current === profileId) continue;
      if (current) other++;
      missing.push(product.id);
    }
    offset += page.products.length;
    if (page.products.length === 0 || offset >= page.count) break;
  }
  out.stdout(
    `${total} termék a boltban; profil nélküli vagy más profilú: ${missing.length} (ebből más profilú: ${other}); a cél: ${profileId}\n`,
  );
  if (!apply) {
    out.stdout("Ez a futás semmit nem írt. A kötéshez: --apply\n");
    return 0;
  }
  let done = 0;
  for (const id of missing) {
    await client.setProductShippingProfile(id, profileId);
    if (done === 0) {
      const readBack = await client.productShippingProfileId(id);
      if (readBack !== profileId) {
        out.stderr(
          `MEGÁLL az első írás után: a(z) ${id} visszaolvasva ${readBack ?? "üres"} (várt: ${profileId}). A lekérdezés mező-alakja vagy az írás nem az, aminek hittük.\n`,
        );
        return 1;
      }
    }
    done++;
  }
  out.stdout(
    `kész: ${done}/${missing.length} termék kötve a(z) ${profileId} profilhoz\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const out = {
    stdout: (v: string) => process.stdout.write(v),
    stderr: (v: string) => process.stderr.write(v),
  };
  let code = 1;
  try {
    const client = await medusaClientForProjection(
      storedCredentialProvider(),
      out,
    );
    code = await runShippingProfileLink(
      process.argv.includes("--apply"),
      client,
      out,
    );
  } catch (error) {
    if (error instanceof MedusaConnectionError)
      out.stderr(`${describeCredentialFailure(error)}\n`);
    else if (error instanceof MedusaConfigurationError)
      out.stderr(`${error.message}\n`);
    else throw error;
  }
  await prisma.$disconnect();
  process.exit(code);
}
