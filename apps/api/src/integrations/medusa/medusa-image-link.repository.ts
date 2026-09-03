import { Inject, Injectable, Optional } from "@nestjs/common";
import { prisma } from "@acropora/database";

/**
 * MELYIK KEPUNK MELYIK BOLTI FAJLRA KERULT FEL.
 *
 * MIERT LETEZIK, ES MIERT NEM ELHAGYHATO: a bolt feltoltese NEM idempotens.
 * Mindket telepitett fajl-provider MAGA general kulcsot, es mindig egyedive
 * teszi (`file-local` ido-belyeget tesz a nev ele, `file-s3` egy `ulid`-ot fuz
 * hozza). Es a bolt oldalan nem is lehet megkerdezni, hogy egy fajl mar fent
 * van-e: a file modul `listFiles` metodusa azonosito nelkul HIBAT DOB
 * ("Listing of files is only supported when filtering by ID"), tehat nev
 * szerinti kereses nincs.
 *
 * Ebbol kovetkezik, hogy a nyilvantartas a MI oldalunkon kell alljon. Enelkul
 * minden vetites-futas ujra feltoltene mind a 3426 kepet, es atirna a termekek
 * kep-URL-jeit.
 *
 * NEM UJ TABLA: az `ExternalReference` ma is ezt csinalja, ket iranyu egyedi
 * kulccsal, tizennegy kulonbozo `entityType` ertekkel. Egy uj tabla uj
 * migraciot, uj indexeket es uj karbantartast hozott volna egy mar megoldott
 * problemara.
 */

/**
 * A LEKEPEZES-SOR KERESESI KULCSA, EGY HELYEN -- ugyanugy, mint a termekeknel
 * es a kategoriaknal, es ugyanabbol az okbol: a `system` a sema
 * `ExternalSystem` ENUMJA (elgepelesre forditasi hiba jon), az `entityType`
 * viszont szabad `String`, tehat ott semmi nem szol, ha ket iro ket irasmodot
 * hasznal.
 */
export const MEDUSA_IMAGE_REFERENCE = {
  system: "MEDUSA",
  entityType: "ProductImage",
} as const;

const { system: SYSTEM, entityType: ENTITY_TYPE } = MEDUSA_IMAGE_REFERENCE;

/**
 * A KEP AZONOSSAGA: A TERMEK ES AZ URL EGYUTT -- ES EZ MERT DONTES.
 *
 * NEM a `ProductImage.id`, mert az NEM STABIL: mindket UNAS-iro
 * `deleteMany` + `createMany` parossal dolgozik a `source: "UNAS"` sorokon, es
 * az `id` `cuid`, tehat MINDEN IMPORT UJ AZONOSITOT ad ugyanannak a kepnek. Egy
 * `id`-re epulo lekepezes az elso import utan arvava valna, es a kovetkezo
 * futas ujra feltoltene mindent -- eppen azt a duplazast okozva, ami ellen ez
 * a tabla keszul.
 *
 * ES NEM IS AZ URL ONMAGABAN. Merve a teljes UNAS exporton (1893 termek, 3426
 * kep): 3422 kulonbozo URL all benne, es NEGY olyan, ami KET-KET termeknel is
 * szerepel. A `ProductImage` sajat egyedi kulcsa is ezert `[productId, url]` --
 * a mi oldalunkon a kep azonossaga MAR igy van definialva, es a lekepezes nem
 * talal ki masikat.
 *
 * AZ ELVALASZTO A KETTOSPONT, es ez azert biztonsagos, mert a `productId` egy
 * `cuid`: csupa alfanumerikus karakter, kettospont nincs benne. Az URL-ben
 * VAN (`https:`), de az mindig az elso kettospont UTAN all, tehat a kulcs
 * egyertelmuen olvashato -- nem is kell visszabontani, mert a hivo mindig a
 * ket ertekbol kepzi.
 */
export function medusaImageKey(productId: string, url: string): string {
  return `${productId}:${url}`;
}

export interface MedusaImageLink {
  /** Az Acropora OS termek azonositoja. */
  productId: string;
  /** A kep URL-je NALUNK (a `ProductImage.url` erteke). */
  sourceUrl: string;
  /** A bolt fajl-KULCSA -- ez az azonossag odaat. */
  medusaFileId: string;
  /** A bolt nyilvanos URL-je -- ez kerul a termek kep-mezojebe. */
  medusaUrl: string;
  lastSyncedAt: Date | null;
}

/** Ugyanarra a kepre MAS bolti fajl all mar, vagy forditva. */
export class MedusaImageLinkConflictError extends Error {
  constructor(
    readonly productId: string,
    readonly sourceUrl: string,
    readonly medusaFileId: string,
    readonly existing: MedusaImageLink,
  ) {
    super("MEDUSA_IMAGE_LINK_CONFLICT");
  }
}

interface ExternalReferenceRow {
  entityId: string;
  externalId: string;
  externalKey: string | null;
  lastSyncedAt: Date | null;
}

export interface MedusaImageLinkDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<ExternalReferenceRow | null>;
    create(args: unknown): Promise<ExternalReferenceRow>;
    update(args: unknown): Promise<ExternalReferenceRow>;
  };
}

export const MEDUSA_IMAGE_LINK_DATABASE = Symbol("MEDUSA_IMAGE_LINK_DATABASE");

/**
 * A SOR VISSZAOLVASASA, ES EGY ORZO A KOZEPEN.
 *
 * Az `externalKey` a sema szerint NULLAZHATO, a hivonak viszont URL kell: az
 * kerul a termek kep-mezojebe. Egy `null` ott csendben `undefined`-kent jelenne
 * meg, es a hiba a BOLTBAN latszana, egy kep helyen.
 *
 * Ezert a hianyzo URL itt HIBA, nem hianyzo mezo. Ha valaha ilyen sor
 * keletkezik (kezzel, vagy egy regebbi iro miatt), jobb hangosan elhasalni,
 * mint egy termeket kep nelkul kikuldeni.
 */
function toLink(row: ExternalReferenceRow): MedusaImageLink {
  const elvalaszto = row.entityId.indexOf(":");
  if (elvalaszto < 0 || row.externalKey === null)
    throw new Error(
      `MEDUSA_IMAGE_LINK_BROKEN_ROW: a lekepezés-sor nem olvasható vissza ` +
        `(entityId=${row.entityId}, externalKey=${row.externalKey ?? "null"})`,
    );

  return {
    productId: row.entityId.slice(0, elvalaszto),
    sourceUrl: row.entityId.slice(elvalaszto + 1),
    medusaFileId: row.externalId,
    medusaUrl: row.externalKey,
    lastSyncedAt: row.lastSyncedAt,
  };
}

@Injectable()
export class MedusaImageLinkRepository {
  private readonly database: MedusaImageLinkDatabase;

  constructor(
    @Optional()
    @Inject(MEDUSA_IMAGE_LINK_DATABASE)
    database?: MedusaImageLinkDatabase,
  ) {
    this.database = database ?? (prisma as unknown as MedusaImageLinkDatabase);
  }

  /** Fel van-e mar toltve ez a kep, es ha igen, hova. */
  async findByImage(
    productId: string,
    url: string,
  ): Promise<MedusaImageLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId: medusaImageKey(productId, url),
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /** Melyik kepunk tartozik ehhez a bolti fajl-kulcshoz, ha van ilyen. */
  async findByMedusaFileId(
    medusaFileId: string,
  ): Promise<MedusaImageLink | null> {
    const row = await this.database.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          externalId: medusaFileId,
        },
      },
    });
    return row ? toLink(row) : null;
  }

  /**
   * Rogziti vagy megerositi a lekepezest.
   *
   * IDEMPOTENS ugyanarra a HAROMASRA: ugyanazt a kepet ugyanarra a bolti
   * fajlra ketszer rogziteni nem hiba, csak a `lastSyncedAt` frissul.
   *
   * AMI VISZONT HIBA, ES HANGOSAN: ha ugyanahhoz a kephez MAS bolti fajl all
   * mar, vagy ugyanahhoz a bolti fajlhoz mas kep. Ilyenkor NEM irjuk felul a
   * meglevot -- egy felulirás itt csendben ARVAN hagyna egy bolti fajlt (amit
   * a bolt oldalan mar nem tudunk megtalalni, mert nev szerint nem lehet
   * keresni), es utolag nem lehetne megmondani, melyik volt a helyes.
   */
  async link(
    productId: string,
    url: string,
    medusaFileId: string,
    medusaUrl: string,
    syncedAt: Date,
  ): Promise<MedusaImageLink> {
    const entityId = medusaImageKey(productId, url);
    const [byImage, byFile] = await Promise.all([
      this.findByImage(productId, url),
      this.findByMedusaFileId(medusaFileId),
    ]);

    for (const existing of [byImage, byFile]) {
      if (
        existing &&
        (existing.productId !== productId ||
          existing.sourceUrl !== url ||
          existing.medusaFileId !== medusaFileId)
      )
        throw new MedusaImageLinkConflictError(
          productId,
          url,
          medusaFileId,
          existing,
        );
    }

    if (byImage)
      return toLink(
        await this.database.externalReference.update({
          where: {
            system_entityType_entityId: {
              system: SYSTEM,
              entityType: ENTITY_TYPE,
              entityId,
            },
          },
          /**
           * A `externalKey` IS frissul, nem csak az idobelyeg. A bolti URL
           * ugyanarra a fajl-kulcsra elvben megvaltozhat (mas hoszt, mas
           * eloteg), es akkor a regi URL egy tovabb nem letezo helyre mutatna
           * -- csendben, mert a kulcs egyezne.
           */
          data: { externalKey: medusaUrl, lastSyncedAt: syncedAt },
        }),
      );

    return toLink(
      await this.database.externalReference.create({
        data: {
          system: SYSTEM,
          entityType: ENTITY_TYPE,
          entityId,
          externalId: medusaFileId,
          externalKey: medusaUrl,
          lastSyncedAt: syncedAt,
        },
      }),
    );
  }
}
