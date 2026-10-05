import { Prisma, prisma, type WebshopParcel } from "@acropora/database";
import { Injectable } from "@nestjs/common";

import type { CarrierCode, ParcelRef } from "./carrier.types.js";

export interface ParcelReservation {
  commerceOrderId: string;
  carrier: CarrierCode;
  reference: string;
  size: string | null;
  codHuf: number | null;
  createdByUserId: string | null;
}

/**
 * A WebshopParcel sorai. Az "egy rendeleshez egy ACTIVE csomag" szabalyt NEM
 * ez az osztaly tartja be olvasassal, hanem az adatbazis: a migracio reszleges
 * egyedi indexe (`WebshopParcel_one_active_per_order_key`). Egy ellenorzes es
 * egy iras kozott ket kattintas atfer; az index kozott nem.
 */
@Injectable()
export class WebshopParcelRepository {
  /**
   * Lefoglalja a rendeles csomagjat, MIELOTT a szallitot hivjuk. Ha mar van
   * ACTIVE sor (kesz csomag vagy folyamatban levo foglalas), `null`: a hivo
   * ezt duplikaciokent kezeli.
   */
  async reserve(reservation: ParcelReservation): Promise<WebshopParcel | null> {
    try {
      return await prisma.webshopParcel.create({
        data: { ...reservation, status: "ACTIVE" },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  confirm(id: string, parcel: ParcelRef): Promise<WebshopParcel> {
    return prisma.webshopParcel.update({
      where: { id },
      data: {
        parcelNumber: parcel.parcelNumber,
        carrierParcelId: parcel.carrierParcelId ?? null,
      },
    });
  }

  /** A biztosan meghiusult foglalas torlese: a szallitonal nem jott letre semmi. */
  async dropReservation(id: string): Promise<void> {
    await prisma.webshopParcel.deleteMany({
      where: { id, parcelNumber: null },
    });
  }

  findActive(commerceOrderId: string): Promise<WebshopParcel | null> {
    return prisma.webshopParcel.findFirst({
      where: { commerceOrderId, status: "ACTIVE" },
    });
  }

  /** Egy lekerdezes a teljes listara (a Rendelesek oldal hasParcel oszlopa). */
  findActiveMany(commerceOrderIds: string[]): Promise<WebshopParcel[]> {
    if (!commerceOrderIds.length) return Promise.resolve([]);
    return prisma.webshopParcel.findMany({
      where: { commerceOrderId: { in: commerceOrderIds }, status: "ACTIVE" },
    });
  }

  /**
   * ACTIVE -> CANCELLED, csak ha a sor meg ACTIVE (ket parhuzamos lemondasbol
   * egy ir). A `unconfirmedOnly` a bizonytalan foglalas feloldasa: kesz
   * csomagot az nem mondhat le.
   */
  async markCancelled(
    id: string,
    options: { unconfirmedOnly?: boolean; olderThan?: Date } = {},
  ): Promise<boolean> {
    const result = await prisma.webshopParcel.updateMany({
      where: {
        id,
        status: "ACTIVE",
        ...(options.unconfirmedOnly ? { parcelNumber: null } : {}),
        ...(options.olderThan ? { createdAt: { lt: options.olderThan } } : {}),
      },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return result.count === 1;
  }
}

/**
 * A Postgres egyedi-sertese. A Prisma a reszleges indexet nem ismeri (a
 * semaban nincs), de a 23505-os hibat ugyanugy P2002-kent adja; a nyers kodot
 * is nezzuk, hogy egy Prisma-verziovaltas ne nyelje el csendben.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002" || /23505/.test(error.message);
  }
  return false;
}
