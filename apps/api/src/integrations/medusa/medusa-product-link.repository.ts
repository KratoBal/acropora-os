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
  metadata?: unknown;
}

/**
 * AZ ÁRVA LEKÉPEZÉS JELE -- a `metadata` egyetlen, névterezett kulcsa alatt.
 *
 * Azért a `metadata`, és nem új oszlop: a jel MEGFIGYELÉS, nem azonosság. A
 * sor `externalId` és `lastSyncedAt` mezőjéhez nem nyúlunk, mert épp azok az
 * egyetlen nyomok, amikből utólag meg lehet mondani, MELYIK bolti termék tűnt
 * el és MIKOR még megvolt.
 */
export const MEDUSA_ORPHAN_METADATA_KEY = "medusaOrphan";

/** Amit a jel tárol. Kifelé is ez megy, hogy a jelentés írhassa. */
export interface MedusaOrphanMark {
  /** Az ELSŐ észlelés. Ez nem íródik felül, mert a kor a lényege. */
  firstObservedAt: string;
  /** A LEGUTÓBBI észlelés. Ez mondja meg, hogy az állapot még mindig áll. */
  lastObservedAt: string;
  /** A bolti azonosító, amire a sor mutatott, amikor árvának bizonyult. */
  medusaProductId: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A JEL LEVÉTELE, HA VAN MIT LEVENNI -- különben a `metadata` KI SEM MEGY.
 *
 * Egy visszaállított bolti termék után a sor újra ép, és egy ottfelejtett jel
 * ilyenkor HAZUDNA. Viszont ha nincs jel, a mezőt nem is küldjük: a `metadata`
 * csere-szemantikájú, tehát egy felesleges kiírás más kulcsait törölné.
 */
function orphanClearPatch(metadata: unknown): { metadata?: unknown } {
  const current = asRecord(metadata);
  if (!(MEDUSA_ORPHAN_METADATA_KEY in current)) return {};
  const { [MEDUSA_ORPHAN_METADATA_KEY]: _removed, ...rest } = current;
  return { metadata: rest };
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

  private async findRowByProductId(
    productId: string,
  ): Promise<ExternalReferenceRow | null> {
    return this.database.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: productId,
        },
      },
    });
  }

  /** Melyik Medusa-termék tartozik ehhez az OS-termékhez, ha van ilyen. */
  async findByProductId(productId: string): Promise<MedusaProductLink | null> {
    const row = await this.findRowByProductId(productId);
    return row ? toLink(row) : null;
  }

  /**
   * MEGJELÖLI a sort, hogy a bolt szerint már nem létezik, amire mutat.
   *
   * NEM TÖRÖL, és nem is ír azonosságot. Egy törlés innen nem semleges: a
   * vetítés következő futása leképezés nélkül a létrehozó ágra menne, tehát a
   * törlésből CSENDBEN ÚJRA LÉTREHOZÁS lenne -- pont az, amit a bolt oldali
   * törlés meg akart szüntetni. A döntést ezért emberre hagyjuk, a jel meg
   * megőrzi hozzá a bizonyítékot.
   *
   * Akkor sem ír, ha a sor időközben MÁS bolti azonosítóra állt: azt a párost
   * nem mi figyeltük meg, tehát nem a mi jelünk való rá.
   */
  async markOrphaned(
    productId: string,
    medusaProductId: string,
    observedAt: Date,
  ): Promise<MedusaOrphanMark | null> {
    const row = await this.findRowByProductId(productId);
    if (!row || row.externalId !== medusaProductId) return null;

    const metadata = asRecord(row.metadata);
    const previous = asRecord(metadata[MEDUSA_ORPHAN_METADATA_KEY]);
    const mark: MedusaOrphanMark = {
      firstObservedAt:
        typeof previous.firstObservedAt === "string"
          ? previous.firstObservedAt
          : observedAt.toISOString(),
      lastObservedAt: observedAt.toISOString(),
      medusaProductId,
    };

    await this.database.externalReference.update({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: productId,
        },
      },
      data: { metadata: { ...metadata, [MEDUSA_ORPHAN_METADATA_KEY]: mark } },
    });
    return mark;
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
    const [byProductRow, byMedusa] = await Promise.all([
      this.findRowByProductId(productId),
      this.findByMedusaProductId(medusaProductId),
    ]);
    const byProduct = byProductRow ? toLink(byProductRow) : null;

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

    if (byProductRow)
      return toLink(
        await this.database.externalReference.update({
          where: {
            system_entityType_entityId: {
              system: SYSTEM,
              entityType: ENTITY_TYPE,
              entityId: productId,
            },
          },
          data: {
            lastSyncedAt: syncedAt,
            ...orphanClearPatch(byProductRow.metadata),
          },
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
