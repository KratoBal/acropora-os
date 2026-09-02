import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

/**
 * Az Acropora OS és a Medusa közötti AZONOSSÁG helye.
 *
 * Nem új szerkezet: az `ExternalReference` már ma is ezt csinálja a UNAS-hoz,
 * és a garanciát nem a kód adja, hanem a modell két egyedi kulcsa MINDKÉT
 * irányba - `[system, entityType, externalId]` és `[system, entityType,
 * entityId]`. Vagyis egy OS-termékhez pontosan egy Medusa-azonosító tartozhat,
 * és egy Medusa-azonosítóhoz pontosan egy OS-termék.
 *
 * AMIT EZ A GARANCIA NEM FED LE, és ezt fontos tudni, mert könnyű többet
 * hinni róla: a leképezést védi, NEM a Medusa sort. Két párhuzamos futás, ami
 * nem talál leképezést, mindkettő létrehozhat a Medusában, és ez a kulcs csak
 * a második leképezés-írást utasítja el - akkorra viszont már két Medusa-termék
 * létezik. A vetítés versenyét ezért nem ez zárja ki, hanem az, hogy egyszerre
 * egyetlen író dolgozik egy terméken.
 */

/**
 * A TERMEK-LINK KERESESI KULCSA, EGY HELYEN -- ES EXPORTALVA.
 *
 * Ugyanaz a szerkezet, mint a kategoriaknal (`MEDUSA_CATEGORY_REFERENCE`), es
 * ugyanabbol az okbol: a `system` a sema `ExternalSystem` ENUMJA, tehat egy
 * elgepeles forditasi hiba, az `entityType` viszont szabad `String`, tehat NEM
 * az.
 *
 * ES ITT A TEVEDES NEMA VOLNA. A vetites parancsanak torlo aga ugyanezt a ket
 * mezot hasznalja, es ha elcsusznanak, a `deleteMany` NULLA sort erintene --
 * a kimenet pedig azt irna, hogy "lekepezes torolve (0 sor)". Semmi nem
 * hibazna, es a mondat megnyugtatna.
 */
export const MEDUSA_PRODUCT_REFERENCE = {
  system: "MEDUSA",
  entityType: "Product",
} as const;

const { system: SYSTEM, entityType: ENTITY_TYPE } = MEDUSA_PRODUCT_REFERENCE;

export interface MedusaProductLink {
  /** Az Acropora OS termék azonosítója. */
  productId: string;
  /** A Medusa `product.id` értéke. */
  medusaProductId: string;
  lastSyncedAt: Date | null;
}

/** Ugyanarra a termékre MÁS Medusa-azonosító áll már, vagy fordítva. */
export class MedusaProductLinkConflictError extends Error {
  constructor(
    readonly productId: string,
    readonly medusaProductId: string,
    readonly existing: MedusaProductLink,
  ) {
    super("MEDUSA_PRODUCT_LINK_CONFLICT");
  }
}

interface ExternalReferenceRow {
  entityId: string;
  externalId: string;
  lastSyncedAt: Date | null;
}

export interface MedusaLinkDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    create(args: unknown): Promise<ExternalReferenceRow>;
    update(args: unknown): Promise<ExternalReferenceRow>;
  };
}

export const MEDUSA_LINK_DATABASE = Symbol("MEDUSA_LINK_DATABASE");

function toLink(row: ExternalReferenceRow): MedusaProductLink {
  return {
    productId: row.entityId,
    medusaProductId: row.externalId,
    lastSyncedAt: row.lastSyncedAt,
  };
}

@Injectable()
export class MedusaProductLinkRepository {
  private readonly database: MedusaLinkDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_LINK_DATABASE)
    database?: MedusaLinkDatabase,
  ) {
    this.database = database ?? (prisma as unknown as MedusaLinkDatabase);
  }

  /** Melyik Medusa-termék tartozik ehhez az OS-termékhez, ha van ilyen. */
  async findByProductId(productId: string): Promise<MedusaProductLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: productId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /** Melyik OS-termék tartozik ehhez a Medusa-azonosítóhoz, ha van ilyen. */
  async findByMedusaProductId(
    medusaProductId: string,
  ): Promise<MedusaProductLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          externalId: medusaProductId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /**
   * Rögzíti vagy megerősíti a leképezést.
   *
   * Idempotens: ugyanazt a párt kétszer rögzíteni nem hiba, csak a
   * `lastSyncedAt` frissül. Ez szándékos, mert a vetítés minden sikeres futás
   * után ezt hívja, és egy „már rögzítve" hibaüzenet ott zaj lenne.
   *
   * AMI VISZONT HIBA, ÉS HANGOSAN: ha ugyanahhoz az OS-termékhez MÁS
   * Medusa-azonosító áll már, vagy ugyanahhoz a Medusa-azonosítóhoz más
   * OS-termék. Ilyenkor NEM írjuk felül a meglévőt. Egy felülírás itt csendben
   * árván hagyna egy Medusa-terméket, és utólag nem lehetne megmondani, melyik
   * volt a helyes - a hívónak kell eldöntenie, mert csak ő tudja, honnan jött
   * az ütköző érték.
   */
  async link(
    productId: string,
    medusaProductId: string,
    syncedAt: Date,
  ): Promise<MedusaProductLink> {
    const [byProduct, byMedusa] = await Promise.all([
      this.findByProductId(productId),
      this.findByMedusaProductId(medusaProductId),
    ]);

    for (const existing of [byProduct, byMedusa]) {
      if (
        existing &&
        (existing.productId !== productId ||
          existing.medusaProductId !== medusaProductId)
      )
        throw new MedusaProductLinkConflictError(
          productId,
          medusaProductId,
          existing,
        );
    }

    if (byProduct)
      return toLink(
        await this.database.externalReference.update({
          where: {
            system_entityType_entityId: {
              system: SYSTEM,
              entityType: ENTITY_TYPE,
              entityId: productId,
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
          entityId: productId,
          externalId: medusaProductId,
          lastSyncedAt: syncedAt,
        },
      }),
    );
  }
}
