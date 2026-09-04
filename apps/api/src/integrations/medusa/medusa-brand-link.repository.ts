import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { MEDUSA_BRAND_REFERENCE } from "./medusa-brand.policy.js";

/**
 * A MARKA ES A MEDUSA-OLDALI GYUJTEMENY KOZOTTI LEKEPEZES.
 *
 * NEM SAJAT TABLA: az altalanos `ExternalReference` sorai, ugyanugy, mint a
 * termeke es a kategoriae. A keresesi kulcs egy helyen all
 * (`MEDUSA_BRAND_REFERENCE`), es azert ott, mert a `system` a sema ENUMJA (aki
 * mellenyul, forditasi hibat kap), az `entityType` viszont szabad `String`.
 *
 * A KET IRANY MINDKETTO KELL, es ez nem kenyelem: a betoltes terve csak akkor
 * tud dontéeni, ha egy markarol meg tudja mondani, hogy MAS gyujtemenyre mutat-e
 * a sorunk, mint amelyik a mi kulso azonositonkat viseli. Ehhez a
 * gyujtemeny-azonosito feloli kereses is kell.
 */

export interface MedusaBrandLink {
  /** Az Acropora OS `Brand.id` erteke. */
  brandId: string;
  /** A Medusa `collection.id` erteke. */
  medusaCollectionId: string;
  lastSyncedAt: Date | null;
}

/** Ugyanarra a markara MAS gyujtemeny all mar, vagy forditva. */
export class MedusaBrandLinkConflictError extends Error {
  constructor(
    readonly brandId: string,
    readonly medusaCollectionId: string,
    readonly existing: MedusaBrandLink,
  ) {
    super("MEDUSA_BRAND_LINK_CONFLICT");
  }
}

interface ExternalReferenceRow {
  entityId: string;
  externalId: string;
  lastSyncedAt: Date | null;
}

export interface MedusaBrandLinkDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    findMany(args: unknown): Promise<ExternalReferenceRow[]>;
    create(args: unknown): Promise<ExternalReferenceRow>;
    update(args: unknown): Promise<ExternalReferenceRow>;
  };
}

export const MEDUSA_BRAND_LINK_DATABASE = Symbol("MEDUSA_BRAND_LINK_DATABASE");

const { system: SYSTEM, entityType: ENTITY_TYPE } = MEDUSA_BRAND_REFERENCE;

function toLink(row: ExternalReferenceRow): MedusaBrandLink {
  return {
    brandId: row.entityId,
    medusaCollectionId: row.externalId,
    lastSyncedAt: row.lastSyncedAt,
  };
}

@Injectable()
export class MedusaBrandLinkRepository {
  private readonly database: MedusaBrandLinkDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_BRAND_LINK_DATABASE)
    database?: MedusaBrandLinkDatabase,
  ) {
    this.database = database ?? (prisma as unknown as MedusaBrandLinkDatabase);
  }

  /**
   * MINDEN lekepezes-sor, egyben.
   *
   * A terv az EGESZ halmazt kapja, nem soronkent kerdez: a hat allapot csak
   * akkor dontheto el, ha a ket oldal teljes kepe egyszerre all rendelkezesre.
   */
  async all(): Promise<MedusaBrandLink[]> {
    const rows = await this.database.externalReference.findMany({
      where: { system: SYSTEM, entityType: ENTITY_TYPE },
    });
    return rows.map(toLink);
  }

  async findByBrandId(brandId: string): Promise<MedusaBrandLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: brandId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  async findByMedusaCollectionId(
    medusaCollectionId: string,
  ): Promise<MedusaBrandLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          externalId: medusaCollectionId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /**
   * Rogziti vagy megerositi a lekepezest.
   *
   * Idempotens ugyanarra a parra: csak a `lastSyncedAt` frissul. AMI VISZONT
   * HIBA, ES HANGOSAN: ha ugyanahhoz a markahoz MAS gyujtemeny all mar, vagy
   * ugyanahhoz a gyujtemenyhez mas marka. Ilyenkor NEM irjuk felul -- a hivo
   * tudja, honnan jott az utkozo ertek, a tarolo nem.
   */
  async link(
    brandId: string,
    medusaCollectionId: string,
    syncedAt: Date,
  ): Promise<MedusaBrandLink> {
    const [byBrand, byCollection] = await Promise.all([
      this.findByBrandId(brandId),
      this.findByMedusaCollectionId(medusaCollectionId),
    ]);

    for (const existing of [byBrand, byCollection]) {
      if (
        existing &&
        (existing.brandId !== brandId ||
          existing.medusaCollectionId !== medusaCollectionId)
      )
        throw new MedusaBrandLinkConflictError(
          brandId,
          medusaCollectionId,
          existing,
        );
    }

    if (byBrand)
      return toLink(
        await this.database.externalReference.update({
          where: {
            system_entityType_entityId: {
              system: SYSTEM,
              entityType: ENTITY_TYPE,
              entityId: brandId,
            },
          },
          data: { lastSyncedAt: syncedAt },
        }),
      );

    return toLink(
      await this.database.externalReference.create({
        data: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: brandId,
          externalId: medusaCollectionId,
          lastSyncedAt: syncedAt,
        },
      }),
    );
  }

  /**
   * A TERV `staleMapping` AGA: a sor egy MAR NEM LETEZO gyujtemenyre mutat, es
   * az ujra letrehozottra kell atirni.
   *
   * KULON METODUS, ES EZ NEM STILUS. A `link` szandekosan MEGTAGADJA a
   * felulirast, mert ott nem tudni, melyik ertek a helyes. Itt viszont a terv
   * MERTE, hogy a regi azonosito nem all a Medusa gyujtemenyei kozott -- nincs
   * mit arvan hagyni. Ha ez a `link`-en belul, egy jelzovel menne, a hivo egy
   * `force: true` ertekkel barmikor kikapcsolhatna a vedelmet; igy viszont a
   * hivas NEVE mondja meg, milyen meresre hivatkozva ir felul.
   */
  async relink(
    brandId: string,
    medusaCollectionId: string,
    syncedAt: Date,
  ): Promise<MedusaBrandLink> {
    return toLink(
      await this.database.externalReference.update({
        where: {
          system_entityType_entityId: {
            system: SYSTEM,
            entityType: ENTITY_TYPE,
            entityId: brandId,
          },
        },
        data: { externalId: medusaCollectionId, lastSyncedAt: syncedAt },
      }),
    );
  }
}
