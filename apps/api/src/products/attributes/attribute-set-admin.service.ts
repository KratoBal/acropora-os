import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import type { CreateAttributeSetDto } from "./dto/attribute-set.dto.js";

/**
 * AZ ATTRIBÚTUM-KÉSZLETEK ÍRÓ OLDALA (S1, kártya 8639ac2a; acrobot 41628/41631, polip 41630).
 * Az olvasó API (`attribute.controller.ts`) eddig csak olvasott: készletet létrehozni és terméket
 * készlethez kötni nem lehetett. Két szűk művelet, külön jogosultsággal
 * (`PRODUCTS_ATTRIBUTE_SET_MANAGE`), mind a kettő a VÉGPONTON őrzött, nem a termék-szerkesztés
 * szabályának lazítása:
 *
 *   1. `createSet`: ÚJ készlet a hozzá tartozó attribútumokkal, egy tranzakcióban. ADDITÍV: meglévő
 *      készletet vagy kötést nem módosít és nem töröl; egy létező kulcs 409.
 *   2. `setProductAttributeSet`: a termék `attributeSetId`-je, és SEMMI MÁS.
 *
 * A KÖTÉS A UNAS-GAZDÁJÚ TERMÉKEN IS MEGY, és ez nem kerülő: az `attributeSetId` OS-oldali
 * metaadat (a UNAS-szinkron nem írja, nincs az `UNAS_WRITABLE_PRODUCT_FIELDS`-ben), tehát a
 * `PRODUCT_MANAGED_BY_UNAS` őr, ami a termék UNAS-tól jövő mezőit védi, erre a mezőre nem
 * vonatkozhat. A kivétel kizárólag erre a mezőre szól, nevvel: egy UNAS-gazdájú termék BÁRMELY
 * MÁS mezője továbbra is 409 a `ProductService.updateProduct` útján (a teszt méri).
 *
 * A KÖTÉS NEM TESZ A TERMÉKET ESEDÉKESSÉ A BOLTI VETÍTÉSRE. A vetítés esedékesség-jele a
 * `Product.updatedAt` (`medusa-projection-due.ts`), a Prisma `@updatedAt` pedig minden írásnál
 * lépteti, tehát egy sima `update` a terméket a következő körben a boltba vinné: a kötés
 * így webshop felé írás lenne, amit Balázs 2026-11-03 18:54-es szava nem enged. A kötés ezért a
 * LÁTOTT `updatedAt`-et írja vissza (a feltételben is: csak arra az állapotra ír), és a mező a
 * vetítésbe sem kerül (az őrző-teszt az `integrations/medusa` forrásait nézi).
 */
@Injectable()
export class AttributeSetAdminService {
  private readonly database = prisma;

  async createSet(input: CreateAttributeSetDto) {
    const key = input.key.trim();
    const name = input.name.trim();
    if (!name) throw new BadRequestException("A készlet neve kötelező.");

    const keys = input.attributes.map((a) => a.attributeKey);
    const duplicated = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (duplicated.length)
      throw new BadRequestException(
        `Egy attribútum csak egyszer szerepelhet: ${[...new Set(duplicated)].join(", ")}.`,
      );

    const known = await this.database.attributeDefinition.findMany({
      where: { key: { in: keys }, isActive: true },
      select: { key: true },
    });
    const knownKeys = new Set(known.map((row) => row.key));
    const unknown = keys.filter((k) => !knownKeys.has(k));
    if (unknown.length)
      throw new BadRequestException(
        `Ismeretlen vagy inaktív attribútum: ${unknown.join(", ")}.`,
      );

    let parentId: string | null = null;
    if (input.parentKey) {
      const parent = await this.database.attributeSet.findUnique({
        where: { key: input.parentKey },
        select: { id: true, isActive: true },
      });
      if (!parent?.isActive)
        throw new BadRequestException(
          `Nincs ilyen aktív szülő készlet: ${input.parentKey}.`,
        );
      parentId = parent.id;
    }

    try {
      return await this.database.$transaction(async (tx) => {
        const set = await tx.attributeSet.create({
          data: { key, name, parentId },
          select: { id: true, key: true, name: true, parentId: true },
        });
        if (input.attributes.length)
          await tx.attributeSetAttribute.createMany({
            data: input.attributes.map((attribute, index) => ({
              attributeSetId: set.id,
              attributeKey: attribute.attributeKey,
              required: attribute.required ?? false,
              filterable: attribute.filterable ?? null,
              group: attribute.group ?? null,
              sortOrder: attribute.sortOrder ?? index,
            })),
          });
        return { ...set, attributeKeys: keys };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(`Már van ilyen kulcsú készlet: ${key}.`);
      throw error;
    }
  }

  /**
   * A termék készlete. `null` leveszi a kötést. Csak az `attributeSetId` íródik, a `updatedAt`
   * változatlanul marad (lásd fent); ha a termék közben megváltozott (más írta a `updatedAt`-et),
   * újraolvassa, legfeljebb háromszor.
   */
  async setProductAttributeSet(
    productId: string,
    attributeSetId: string | null,
    /** the authenticated user: the audit row says WHO bound or unbound */
    actorUserId: string,
  ): Promise<{
    productId: string;
    attributeSetId: string | null;
    changed: boolean;
  }> {
    if (attributeSetId !== null) {
      const set = await this.database.attributeSet.findUnique({
        where: { id: attributeSetId },
        select: { id: true, isActive: true },
      });
      if (!set?.isActive)
        throw new BadRequestException("Nincs ilyen aktív attribútum-készlet.");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const product = await this.database.product.findUnique({
        where: { id: productId },
        select: { id: true, attributeSetId: true, updatedAt: true },
      });
      if (!product) throw new NotFoundException("A termék nem található.");
      if (product.attributeSetId === attributeSetId)
        return { productId, attributeSetId, changed: false };
      /*
        A KÖTÉS ÉS AZ AUDIT SOR EGY TRANZAKCIÓBAN (acrobot 41724): az S1 476 terméket köt, és később
        kérdés lesz, ki mit kötött. A sor csak VALÓDI változásról készül (a változatlan érték fent
        már visszatért, az elvesztett versenyen a `count` 0). A visszavétel (`null`) is ír, más
        névvel, hogy a „ki kötötte” és a „ki vette le” külön lekérdezhető legyen. Ha az audit írása
        elbukik, a kötés is visszagördül: kötés nyom nélkül nincs.
      */
      const bound = await this.database.$transaction(async (transaction) => {
        const written = await transaction.product.updateMany({
          // `attributeSetId` is in the condition too: a binding does not move `updatedAt`, so
          // two bindings from the same seen state would otherwise BOTH win, and the second
          // audit row would claim the wrong `from` (barracuda, #2109 review)
          where: {
            id: productId,
            updatedAt: product.updatedAt,
            attributeSetId: product.attributeSetId,
          },
          data: { attributeSetId, updatedAt: product.updatedAt },
        });
        if (written.count !== 1) return false;
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action:
              attributeSetId === null
                ? "product.attribute-set.unbound"
                : "product.attribute-set.bound",
            entityType: "Product",
            entityId: productId,
            metadata: { from: product.attributeSetId, to: attributeSetId },
          },
        });
        return true;
      });
      if (bound) return { productId, attributeSetId, changed: true };
    }
    throw new ConflictException(
      "A termék közben többször megváltozott, próbáld újra.",
    );
  }
}
