import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import { describeTarget } from "../partner-migration/partner-migration.cli.js";
import {
  applyShippingFill,
  planShippingFill,
  type ShippingFillReport,
} from "./shipping-profile-fill.js";

/** Ennyi eltérő kézi jelzőt mutat a próba; a teljes szám mindig ott áll. */
export const MANUAL_DIFFERS_SHOWN = 200;

export interface ShippingFillPreview {
  /** a cél-adatbázis, jelszó nélkül: a stage-próba és az éles futás ugyanaz a hívás */
  target: string;
  report: Omit<ShippingFillReport, "manualDiffers"> & {
    manualDiffers: ShippingFillReport["manualDiffers"];
    manualDiffersTotal: number;
  };
  fingerprint: string;
}

export interface ShippingFillApplyResult {
  target: string;
  created: number;
  updated: number;
}

/** A feltöltés naplósora: ki, mikor, mit írt (a darabszámok és a lenyomat). */
@Injectable()
export class ShippingProfileFillRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async record(input: {
    userId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.database.auditLog.create({
      data: {
        userId: input.userId,
        action: "product_shipping_profile.filled",
        entityType: "ProductShippingProfile",
        entityId: null,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * A FELTÖLTŐ ADMIN VÉGPONTJA (a82ed229; acrobot 42998: a flottának nincs konténer-végrehajtása, ezért a parancs
 * mellé végpont kell, a partner-átvezetés mintájára). A próba csak olvas; az írás a próba lenyomatát kéri vissza,
 * újraszámol, és csak egyezésnél ír, ugyanazzal a maggal, mint a `shipping-profile:fill` parancs.
 */
@Injectable()
export class ShippingProfileFillService {
  constructor(private readonly repository: ShippingProfileFillRepository) {}

  private target = (): string => describeTarget(process.env.DATABASE_URL);

  async preview(): Promise<ShippingFillPreview> {
    const { report, fingerprint } = await planShippingFill();
    return {
      target: this.target(),
      report: {
        ...report,
        manualDiffers: report.manualDiffers.slice(0, MANUAL_DIFFERS_SHOWN),
        manualDiffersTotal: report.manualDiffers.length,
      },
      fingerprint,
    };
  }

  async apply(
    fingerprint: string,
    actorUserId: string,
  ): Promise<ShippingFillApplyResult> {
    const { report, changes, fingerprint: now } = await planShippingFill();
    if (now !== fingerprint)
      throw new ConflictException(
        "A terv közben változott (vagy a lenyomat nem ehhez a próbához tartozik): nézd meg újra a próbát.",
      );
    await applyShippingFill(changes);
    await this.repository.record({
      userId: actorUserId,
      metadata: {
        target: this.target(),
        fingerprint,
        created: report.create,
        updated: report.update,
        updatedFlags: report.updatedFlags,
      },
    });
    return {
      target: this.target(),
      created: report.create,
      updated: report.update,
    };
  }
}
