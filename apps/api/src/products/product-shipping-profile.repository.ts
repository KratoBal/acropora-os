import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import type { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";
import type { OsShippingProfile } from "../integrations/medusa/medusa-shipping-attributes.policy.js";
import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";
import type {
  ShippingFlag,
  ShippingFlagSource,
} from "./shipping-profile-sources.js";

type ProfileRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.productShippingProfile.findUnique>>
>;

interface ProfileTransaction {
  productShippingProfile: {
    findUnique(args: unknown): Promise<ProfileRecord | null>;
    create(args: unknown): Promise<ProfileRecord>;
    update(args: unknown): Promise<ProfileRecord>;
  };
  /** the product's UNAS data, for the first write's baseline (barracuda, #2198 a) */
  unasProductSnapshot: {
    findUnique(args: unknown): Promise<{ rawPayload: unknown } | null>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
  domainEvent: { create(args: unknown): Promise<unknown> };
}

export interface ProductShippingProfileDatabase {
  product: { findUnique(args: unknown): Promise<{ id: string } | null> };
  productShippingProfile: {
    findUnique(args: unknown): Promise<ProfileRecord | null>;
  };
  $transaction<T>(
    operation: (transaction: ProfileTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export const PRODUCT_SHIPPING_PROFILE_DATABASE = Symbol(
  "PRODUCT_SHIPPING_PROFILE_DATABASE",
);

/**
 * A NEGY JELZO EGYUTT ALL VAGY SEHOGY -- ezert nincs "megvaltozott mezok" lista.
 *
 * A `ProductExtension` naplója azt rogziti, MELYIK mezo mozdult, mert ott a
 * hivo reszlegesen is irhat. Itt a DTO mind a negyet koveteli, tehat minden
 * iras a TELJES allapotot allitja be -- a valtozas-lista helyett a ELOTTE es
 * UTANA allapot a hasznos, es azt is rogzitjuk.
 */
export interface ProductShippingProfileDetail {
  productId: string;
  pickupOnly: boolean;
  foxpostForbidden: boolean;
  isHeavy: boolean;
  isFrozen: boolean;
  lockerUnsuitable: boolean;
  /** A jelzők forrása (a82ed229): `UNAS` a szinkroné, `MANUAL` a kézi. */
  sources: Record<ShippingFlag, ShippingFlagSource>;
  updatedAt: string;
}

const FLAGS = [
  "pickupOnly",
  "foxpostForbidden",
  "isHeavy",
  "isFrozen",
] as const satisfies readonly (keyof UpsertProductShippingProfileDto)[];

function toDetail(profile: ProfileRecord): ProductShippingProfileDetail {
  return {
    productId: profile.productId,
    pickupOnly: profile.pickupOnly,
    foxpostForbidden: profile.foxpostForbidden,
    isHeavy: profile.isHeavy,
    isFrozen: profile.isFrozen,
    lockerUnsuitable: profile.lockerUnsuitable,
    sources: {
      pickupOnly: profile.pickupOnlySource,
      foxpostForbidden: profile.foxpostForbiddenSource,
      isHeavy: profile.isHeavySource,
      isFrozen: profile.isFrozenSource,
    },
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/**
 * A KÉZI ÍRÁS (a82ed229): csak a megváltozott jelző lesz kézi. A kártya mind a
 * négyet elküldi, és ha mindet kézire állítanánk, egy javítás a többi, UNAS-ból
 * jövő jelzőt is lefagyasztaná.
 *
 * AZ ELSŐ ÍRÁS (még nincs sor; barracuda, #2198 a): a szinkron csak az általa érintett terméknek hoz létre sort, és
 * a feltöltő még nem futott, tehát sok terméknek nincs. Ilyenkor a „változás” mércéje a termék UNAS-adata
 * (`unasBaseline`): ami azzal egyezik, az `UNAS` marad (a szinkron tovább követi), csak az eltérő lesz kézi. Ha a
 * terméknek nincs UNAS-adata (csak az OS-ben él), nincs mit követni: minden jelző kézi, ahogy eddig.
 */
export function manualShippingWrite(
  existing: ProfileRecord | null,
  input: UpsertProductShippingProfileDto,
  unasBaseline: { unas: OsShippingProfile | null } | null = null,
): Record<string, boolean | ShippingFlagSource> {
  const data: Record<string, boolean | ShippingFlagSource> = {};
  for (const flag of FLAGS) {
    if (existing) {
      if (existing[flag] === input[flag]) continue;
      data[flag] = input[flag];
      data[`${flag}Source`] = "MANUAL";
      continue;
    }
    data[flag] = input[flag];
    data[`${flag}Source`] =
      unasBaseline && input[flag] === (unasBaseline.unas?.[flag] ?? false)
        ? "UNAS"
        : "MANUAL";
  }
  if (input.lockerUnsuitable !== undefined)
    data.lockerUnsuitable = input.lockerUnsuitable;
  return data;
}

@Injectable()
export class ProductShippingProfileRepository extends Repository {
  private readonly profileDatabase: ProductShippingProfileDatabase;

  constructor(
    @Optional()
    @Inject(PRODUCT_SHIPPING_PROFILE_DATABASE)
    database?: ProductShippingProfileDatabase,
  ) {
    super(prisma);
    this.profileDatabase =
      database ?? (prisma as unknown as ProductShippingProfileDatabase);
  }

  async productExists(productId: string): Promise<boolean> {
    return Boolean(
      await this.profileDatabase.product.findUnique({
        where: { id: productId },
        select: { id: true },
      }),
    );
  }

  async findByProductId(
    productId: string,
  ): Promise<ProductShippingProfileDetail | null> {
    const profile =
      await this.profileDatabase.productShippingProfile.findUnique({
        where: { productId },
      });
    return profile ? toDetail(profile) : null;
  }

  async upsert(
    productId: string,
    input: UpsertProductShippingProfileDto,
    actorUserId: string,
  ): Promise<ProductShippingProfileDetail> {
    return this.profileDatabase.$transaction(
      async (transaction) => {
        const existing = await transaction.productShippingProfile.findUnique({
          where: { productId },
        });
        const snapshot = existing
          ? null
          : await transaction.unasProductSnapshot.findUnique({
              where: { productId },
              select: { rawPayload: true },
            });
        const data = manualShippingWrite(
          existing,
          input,
          snapshot ? { unas: unasShippingProfile(snapshot.rawPayload) } : null,
        );
        /*
          AN EXPLICIT UPDATE OR CREATE, NOT AN UPSERT: Prisma checks an upsert's `create` part even when the row
          exists, and for an existing row `data` holds only the changed flags, so a save that changed less than all
          four failed (found by the bulk edit's database test, a82ed229 2c). The read above is in the same
          serializable transaction, so the branch is the row's real state.
        */
        const profile = existing
          ? await transaction.productShippingProfile.update({
              where: { productId },
              data,
            })
          : await transaction.productShippingProfile.create({
              data: { productId, ...data },
            });
        const action = existing
          ? "product_shipping_profile.updated"
          : "product_shipping_profile.created";
        /**
         * A NAPLO AZ ELOTTE-UTANA ALLAPOTOT VISZI, NEM A VALTOZAS-LISTAT.
         *
         * Mind a negy jelzo emberi itelet, es egy iras MINDIG mind a negyet
         * beallitja. Egy "ezek valtoztak" lista tehat kevesebbet mondana: nem
         * derulne ki belole, mire allitotta a szerkeszto azt, amihez nem nyult.
         */
        const metadata = {
          productId,
          before: existing
            ? {
                ...Object.fromEntries(FLAGS.map((f) => [f, existing[f]])),
                lockerUnsuitable: existing.lockerUnsuitable,
              }
            : null,
          after: {
            ...Object.fromEntries(FLAGS.map((f) => [f, profile[f]])),
            lockerUnsuitable: profile.lockerUnsuitable,
          },
        } satisfies Prisma.JsonObject;
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action,
            entityType: "ProductShippingProfile",
            entityId: profile.id,
            metadata,
          },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: action,
            aggregateType: "Product",
            aggregateId: productId,
            actorUserId,
            payload: metadata,
            occurredAt: new Date(),
          },
        });
        return toDetail(profile);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
