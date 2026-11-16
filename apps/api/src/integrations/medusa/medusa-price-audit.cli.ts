import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  MedusaConfigurationError,
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { decidePricingProjection } from "./medusa-pricing.policy.js";
import {
  resolvePricingTargets,
  type PricingCliDatabase,
} from "./medusa-pricing.cli.js";
import { matchVariant } from "./medusa-pricing-projection.service.js";
import {
  auditProducts,
  parseAuditArguments,
  type PriceAuditDeps,
} from "./medusa-price-audit.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import {
  parseBatchArguments,
  selectBatchTargets,
} from "./medusa-projection-batch.js";

/**
 * A kozos osszeallitas: az OS oldali celok (csak `findMany` olvasasok), a kotes, a Medusa olvasasa pontosan EGY metodussal. Az audit
 * parancs es a javito vegpont ugyanezt hasznalja, hogy a ketto ne ertelmezze maskeppen az OS arat vagy a valtozat-illesztest.
 */
export function priceAuditDeps(
  client: {
    listVariantPrices: MedusaAdminClient["listVariantPrices"];
  },
  database: PricingCliDatabase,
  links = new MedusaProductLinkRepository(),
): PriceAuditDeps {
  return {
    resolve: async (osProductId) => {
      const { targets, errors } = await resolvePricingTargets(
        osProductId,
        database,
      );
      return {
        targets: targets.map((target) => {
          const decision = decidePricingProjection(target.price);
          return {
            osProductId: target.osProductId,
            sku: target.sku,
            osAmount: decision.send ? decision.amount : null,
          };
        }),
        errors,
      };
    },
    findMedusaProductId: async (osProductId) =>
      (await links.findByProductId(osProductId))?.medusaProductId ?? null,
    // pontosan egy metodus: olvas
    reader: {
      listVariantPrices: (medusaProductId) =>
        client.listVariantPrices(medusaProductId),
    },
    matchVariant,
  };
}

/**
 * A KETTOS FORINT AR KIZAROLAG OLVASO MERESE (task t-20261116-ket-forint-ar, acrobot 53839), a parancssori fuggo resz.
 *
 * Termekenkent: az OS ar (amit a vetites kuldene), a Medusa valtozat forint ar sorai (osszeg, egyszeru-e), es a kesobbi, KULON lepesben
 * jovahagyott adatjavitas javaslata (melyik sor marad, melyik torlendo). SEMMIT nem ir: a Medusa feluleten CSAK a `listVariantPrices`
 * (admin GET) van bekotve, az OS oldalon csak `findMany` olvasasok (`resolvePricingTargets`), es nincs `--forget-link`.
 *
 * Hasznalat (a stage-en a konteneren belul, `cd /app`):
 *   node dist/integrations/medusa/medusa-price-audit.cli.js <termekazonosito> [tovabbi...] [--all]
 *   node dist/integrations/medusa/medusa-price-audit.cli.js --limit 500 [--from <termekazonosito>] [--all]
 * Alapbol csak a javitando (nem egy-soros, nem ures) valtozatok sora jelenik meg; `--all` mindet kiirja. A `# ` kezdetu sorok az
 * olvashatatlan termekek es az osszesites.
 */
export async function runPriceAuditCli(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: PricingCliDatabase = prisma,
  /** A kivalasztott termekek azonositoi (a vegpont lapozasahoz); nem ir, nem olvas tobbet. */
  onTargets: (productIds: readonly string[]) => void = () => undefined,
): Promise<number> {
  const audit = parseAuditArguments(args);
  if (audit.kind === "error") {
    out.stderr(`${audit.message}\n`);
    return 1;
  }
  const parsed = parseBatchArguments(audit.batchArgs);
  if (parsed.kind === "error") {
    out.stderr(`${parsed.message}\n`);
    return 1;
  }
  const productIds = await selectBatchTargets(parsed.selection, database);
  onTargets(productIds);

  let client: Awaited<ReturnType<typeof medusaClientForProjection>>;
  try {
    client = await medusaClientForProjection(credentials, out);
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
  const deps = priceAuditDeps(client, database);

  await auditProducts(productIds, deps, out, { all: audit.all });
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runPriceAuditCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
