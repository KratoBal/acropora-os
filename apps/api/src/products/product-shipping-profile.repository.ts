import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

import type { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";

type ProfileRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.productShippingProfile.findUnique>>
>;

interface ProfileTransaction {
  productShippingProfile: {
    findUnique(args: unknown): Promise<ProfileRecord | null>;
    upsert(args: unknown): Promise<ProfileRecord>;
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
    updatedAt: profile.updatedAt.toISOString(),
  };
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
        const profile = await transaction.productShippingProfile.upsert({
          where: { productId },
          update: input,
          create: { productId, ...input },
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
            ? Object.fromEntries(FLAGS.map((f) => [f, existing[f]]))
            : null,
          after: Object.fromEntries(FLAGS.map((f) => [f, profile[f]])),
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
