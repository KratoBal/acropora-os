import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

/**
 * A KATEGORIA-AZONOSSAG helye az Acropora OS es a Medusa kozott.
 *
 * Ugyanaz a szerkezet, mint a termekeknel (`MedusaProductLinkRepository`), es
 * ugyanaz, amit a UNAS import hasznal kategoriakra a masik rendszer fele: az
 * `ExternalReference` tabla ket egyedi kulcsa vedi MINDKET iranyt --
 * `[system, entityType, externalId]` es `[system, entityType, entityId]`.
 *
 * MIERT KELL EGYALTALAN, HOLOTT A MEDUSA IS HORDOZZA A MI AZONOSITONKAT. Mert
 * a ket iranyban MASRA kerdezunk. A betoltes megismetelhetosegehez a MEDUSABAN
 * keressuk a mi azonositonkat; a termek-vetiteshez viszont NALUNK kell
 * megtalalni a Medusa-azonositot, egy kategoria-azonositobol kiindulva. Ha
 * csak a Medusa oldal allna, minden vetites-futasnak vegig kellene kerdeznie a
 * teljes kategoria-listat.
 *
 * AMIT EZ A GARANCIA NEM FED LE, ugyanaz, mint a termekeknel: a LEKEPEZEST
 * vedi, nem a Medusa sort. Ket parhuzamos futas, ami nem talal lekepezest,
 * mindketto letrehozhat a Medusaban, es a kulcs csak a masodik lekepezes-irast
 * utasitja el -- akkorra viszont mar ket kategoria all. A betoltes verseneet
 * nem ez zarja ki, hanem az, hogy egyszerre egy iro fut.
 */

const SYSTEM = "MEDUSA" as const;
const ENTITY_TYPE = "Category" as const;

export interface MedusaCategoryLink {
  /** Az Acropora OS `Category.id` erteke. */
  categoryId: string;
  /** A Medusa `product_category.id` erteke. */
  medusaCategoryId: string;
  lastSyncedAt: Date | null;
}

/** Ugyanarra a kategoriara MAS Medusa-azonosito all mar, vagy forditva. */
export class MedusaCategoryLinkConflictError extends Error {
  constructor(
    readonly categoryId: string,
    readonly medusaCategoryId: string,
    readonly existing: MedusaCategoryLink,
  ) {
    super("MEDUSA_CATEGORY_LINK_CONFLICT");
  }
}

interface ExternalReferenceRow {
  entityId: string;
  externalId: string;
  lastSyncedAt: Date | null;
}

export interface MedusaCategoryLinkDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    findMany(args: unknown): Promise<ExternalReferenceRow[]>;
    create(args: unknown): Promise<ExternalReferenceRow>;
    update(args: unknown): Promise<ExternalReferenceRow>;
  };
}

export const MEDUSA_CATEGORY_LINK_DATABASE = Symbol(
  "MEDUSA_CATEGORY_LINK_DATABASE",
);

function toLink(row: ExternalReferenceRow): MedusaCategoryLink {
  return {
    categoryId: row.entityId,
    medusaCategoryId: row.externalId,
    lastSyncedAt: row.lastSyncedAt,
  };
}

@Injectable()
export class MedusaCategoryLinkRepository {
  private readonly database: MedusaCategoryLinkDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_CATEGORY_LINK_DATABASE)
    database?: MedusaCategoryLinkDatabase,
  ) {
    this.database =
      database ?? (prisma as unknown as MedusaCategoryLinkDatabase);
  }

  /**
   * MINDEN lekepezes-sor, egyben.
   *
   * A betoltes terve az EGESZ halmazt kapja, nem soronkent kerdez: 219
   * kategorianal a soronkenti kerdes 219 kor lenne, es a terv ugyis az egeszet
   * nezi vegig. Ez nem gyorsitasi finomsag -- a terv ot allapota csak akkor
   * dontheto el, ha a ket oldal TELJES kepe egyszerre all rendelkezesre.
   */
  async all(): Promise<MedusaCategoryLink[]> {
    const rows = await this.database.externalReference.findMany({
      where: { system: SYSTEM, entityType: ENTITY_TYPE },
    });
    return rows.map(toLink);
  }

  async findByCategoryId(
    categoryId: string,
  ): Promise<MedusaCategoryLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: categoryId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  async findByMedusaCategoryId(
    medusaCategoryId: string,
  ): Promise<MedusaCategoryLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          externalId: medusaCategoryId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /**
   * Rogziti vagy megerositi a lekepezest.
   *
   * Idempotens ugyanarra a parra: csak a `lastSyncedAt` frissul. AMI VISZONT
   * HIBA, ES HANGOSAN: ha ugyanahhoz a kategoriahoz MAS Medusa-azonosito all
   * mar, vagy ugyanahhoz a Medusa-azonositohoz mas kategoria. Ilyenkor NEM
   * irjuk felul -- a hivo tudja, honnan jott az utkozo ertek, a tarolo nem.
   */
  async link(
    categoryId: string,
    medusaCategoryId: string,
    syncedAt: Date,
  ): Promise<MedusaCategoryLink> {
    const [byCategory, byMedusa] = await Promise.all([
      this.findByCategoryId(categoryId),
      this.findByMedusaCategoryId(medusaCategoryId),
    ]);

    for (const existing of [byCategory, byMedusa]) {
      if (
        existing &&
        (existing.categoryId !== categoryId ||
          existing.medusaCategoryId !== medusaCategoryId)
      )
        throw new MedusaCategoryLinkConflictError(
          categoryId,
          medusaCategoryId,
          existing,
        );
    }

    if (byCategory)
      return toLink(
        await this.database.externalReference.update({
          where: {
            system_entityType_entityId: {
              system: SYSTEM,
              entityType: ENTITY_TYPE,
              entityId: categoryId,
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
          entityId: categoryId,
          externalId: medusaCategoryId,
          lastSyncedAt: syncedAt,
        },
      }),
    );
  }

  /**
   * A TERV `staleMapping` AGA: a sor egy MAR NEM LETEZO Medusa-azonositora
   * mutat, es ujra letrehozott kategoriara kell atirni.
   *
   * KULON METODUS, ES EZ NEM STILUS. A `link` szandekosan MEGTAGADJA a
   * felulirast, mert ott nem tudni, melyik ertek a helyes. Itt viszont a terv
   * MERTE, hogy a regi azonosito nem all a Medusa kategoriai kozott -- nincs
   * mit arvan hagyni. Ha ez a `link`-en belul, egy jelzovel menne, akkor a
   * hivo egy `force: true` ertekkel barmikor kikapcsolhatna a vedelmet; igy
   * viszont a hivas NEVE mondja meg, milyen meresre hivatkozva ir felul.
   */
  async relink(
    categoryId: string,
    medusaCategoryId: string,
    syncedAt: Date,
  ): Promise<MedusaCategoryLink> {
    return toLink(
      await this.database.externalReference.update({
        where: {
          system_entityType_entityId: {
            system: SYSTEM,
            entityType: ENTITY_TYPE,
            entityId: categoryId,
          },
        },
        data: { externalId: medusaCategoryId, lastSyncedAt: syncedAt },
      }),
    );
  }
}
