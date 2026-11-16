import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  adoptPickup,
  gatherUnmarkedPickup,
  type PickupAdoptionDatabase,
  type PickupAdoptionResult,
  type PickupVerdict,
  type UnmarkedPickupEntry,
} from "./medusa-pickup-adoption.js";
import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/**
 * A MULTBELI ATVETEL LISTAJA ES ATNEZETT ADOPTALASA VEGPONTON (kartya c603774e, acrobot 45855): a stage API konteneren a flotta nem
 * futtat parancsot, tehat a fo ut az API. A szabaly ugyanaz, mint a parancsne (`medusa-pickup-adoption.ts`), egy osszeallito
 * fuggvenyen keresztul.
 */
export const MEDUSA_PICKUP_ADOPTION_DEPS = Symbol(
  "MEDUSA_PICKUP_ADOPTION_DEPS",
);

export interface MedusaPickupAdoptionDeps {
  shipping?: () => Promise<MedusaShippingAttributesService>;
  database?: PickupAdoptionDatabase;
}

export interface PickupAdoptionListView {
  /** a bolt valaszaban van-e jelolo mezo (a commerce #724 telepitve van-e): nelkule a lista ures */
  markKnown: boolean;
  /** a bolt szallitasi-jellemzo soranak szama */
  rows: number;
  /** hany sor mar jelolt */
  marked: number;
  counts: Record<PickupVerdict, number>;
  entries: UnmarkedPickupEntry[];
}

export interface PickupAdoptionApplyView extends PickupAdoptionResult {
  /** hamis = terv, a boltba nem irtunk */
  apply: boolean;
}

@Injectable()
export class MedusaPickupAdoptionService {
  private readonly logger = new Logger(MedusaPickupAdoptionService.name);
  private readonly shipping: () => Promise<MedusaShippingAttributesService>;
  private readonly database: PickupAdoptionDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_PICKUP_ADOPTION_DEPS)
    deps?: MedusaPickupAdoptionDeps,
  ) {
    this.database =
      deps?.database ?? (prisma as unknown as PickupAdoptionDatabase);
    this.shipping =
      deps?.shipping ??
      (async () =>
        new MedusaShippingAttributesService(
          new MedusaProductLinkRepository(),
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: () => undefined,
            stderr: () => undefined,
          }),
        ));
  }

  /** CSAK OLVAS: a bolt szallitasi-jellemzo sorait es SKU-listajat, az OS adatbazisat. */
  async list(): Promise<PickupAdoptionListView> {
    const report = await gatherUnmarkedPickup(
      await this.shipping(),
      this.database,
    );
    const counts: Record<PickupVerdict, number> = {
      none: 0,
      live: 0,
      profile: 0,
      unpaired: 0,
    };
    for (const entry of report.unmarked) counts[entry.verdict] += 1;
    return {
      markKnown: report.markKnown,
      rows: report.rows,
      marked: report.marked,
      counts,
      entries: report.unmarked,
    };
  }

  /**
   * A felsorolt OS-termekek jelolese. `apply` hamis (alapbol) = terv: nem ir. A szabaly a magban all: csak `live` es `none`,
   * az elgepelt vagy nem adoptalhato azonositot megnevezi. A regi bolton (nincs jelolo mezo) 409.
   */
  async adopt(
    osProductIds: readonly string[],
    apply: boolean,
    actorId?: string,
  ): Promise<PickupAdoptionApplyView> {
    const shipping = await this.shipping();
    const report = await gatherUnmarkedPickup(shipping, this.database);
    if (!report.markKnown)
      throw new HttpException(
        "MEDUSA_PICKUP_MARK_UNKNOWN",
        HttpStatus.CONFLICT,
      );
    const result = await adoptPickup(
      shipping,
      report,
      new Set(osProductIds),
      apply,
    );
    if (apply)
      this.logger.log(
        `Átvétel adoptálása (${actorId ?? "ismeretlen felhasználó"}): ${
          result.adopted.filter((a) => a.action === "applied").length
        } jelölve, ${result.refused.length} elutasítva; azonosítók: ${result.adopted
          .map((a) => `${a.osProductId}=${a.action}`)
          .join(", ")}`,
      );
    return { apply, ...result };
  }
}
