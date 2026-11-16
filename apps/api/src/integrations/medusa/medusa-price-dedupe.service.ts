import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  dedupeCounts,
  dedupeProducts,
  type DedupeDeps,
  type DedupeEntry,
} from "./medusa-price-dedupe.js";
import { priceAuditDeps } from "./medusa-price-audit.cli.js";
import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";

/**
 * The switch that opens the repair at all (acrobot 53863): only the exact text `true` opens it, anything else, including a missing
 * variable, keeps it shut. The endpoint is in the API image that also runs in production, and where the shop connection points
 * there is not measured, so the default is closed and the fleet lead opens it on the stage for the run.
 */
export function priceRepairEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.MEDUSA_PRICE_REPAIR_ENABLED === "true";
}

/** Test seam only: the real builder reads the stored Medusa credentials and the OS database. */
export const MEDUSA_PRICE_DEDUPE_DEPS = Symbol("MEDUSA_PRICE_DEDUPE_DEPS");

export interface MedusaPriceDedupeSeam {
  deps?: () => Promise<DedupeDeps>;
  enabled?: () => boolean;
}

export interface PriceDedupeView {
  /** false = a plan, nothing was written */
  apply: boolean;
  counts: Record<string, number>;
  entries: DedupeEntry[];
}

@Injectable()
export class MedusaPriceDedupeService {
  private readonly logger = new Logger(MedusaPriceDedupeService.name);
  private running = false;
  private readonly buildDeps: () => Promise<DedupeDeps>;
  readonly enabled: () => boolean;

  constructor(
    @Optional()
    @Inject(MEDUSA_PRICE_DEDUPE_DEPS)
    seam?: MedusaPriceDedupeSeam,
  ) {
    this.enabled = seam?.enabled ?? (() => priceRepairEnabled());
    this.buildDeps =
      seam?.deps ??
      (async () => {
        const client = await medusaClientForProjection(
          storedCredentialProvider(),
          { stdout: () => undefined, stderr: () => undefined },
        );
        return {
          ...priceAuditDeps(client, prisma),
          writer: {
            setVariantPrices: (productId, variantId, prices) =>
              client.setVariantPrices(productId, variantId, prices),
          },
        };
      });
  }

  async run(
    osProductIds: readonly string[],
    apply: boolean,
    actorId?: string,
  ): Promise<PriceDedupeView> {
    if (this.running)
      throw new HttpException(
        "MEDUSA_PRICE_REPAIR_BUSY",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.running = true;
    try {
      const entries = await dedupeProducts(
        osProductIds,
        await this.buildDeps(),
        { apply },
      );
      if (apply)
        this.logger.log(
          `Ár-ismétlődés javítása (${actorId ?? "ismeretlen felhasználó"}): ${JSON.stringify(
            dedupeCounts(entries),
          )}; azonosítók: ${entries
            .filter((entry) => entry.action === "fixed")
            .map((entry) => `${entry.osProductId}=${entry.keepId}`)
            .join(", ")}`,
        );
      return { apply, counts: dedupeCounts(entries), entries };
    } finally {
      this.running = false;
    }
  }
}
