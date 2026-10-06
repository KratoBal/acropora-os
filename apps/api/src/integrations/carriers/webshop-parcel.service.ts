import type { WebshopParcel } from "@acropora/database";
import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  type CarrierClient,
  type CarrierCode,
  CarrierError,
  type CarrierErrorCode,
  type ParcelDestination,
  type ParcelRef,
  type ParcelSize,
  type TrackingEvent,
} from "./carrier.types.js";
import { carrierClientFor } from "./carrier-client.factory.js";
import { isStubParcelNumber } from "./stub-carrier.client.js";
import { shipmentReference } from "./shipment-reference.js";
import { WebshopParcelRepository } from "./webshop-parcel.repository.js";

/** A kliens a szallito kodjara; a tesztek itt adnak hamis klienst. */
export const CARRIER_CLIENTS = Symbol("CARRIER_CLIENTS");
export type CarrierClients = (carrier: CarrierCode) => CarrierClient;

/**
 * Amig egy foglalas ennel fiatalabb, a hivasa meg futhat (a kliens 20 mp
 * utan feladja), ezert nem oldhato fel: kulonben a futo hivas mellett egy
 * masodik csomag indulhatna.
 */
export const RESERVATION_RELEASE_AFTER_MS = 2 * 60_000;

/**
 * BIZONYTALAN KIMENET: a szallitonal a csomag LETREJOHETETT. Ilyenkor a
 * foglalas megmarad (csomagszam nelkul), es uj letrehozast csak egy
 * kifejezett feloldas enged (`releaseUnconfirmed`), miutan valaki megnezte a
 * szallito feluleten. Minden mas hiba biztos elutasitas: a foglalas torlodik.
 */
const UNCERTAIN: ReadonlySet<CarrierErrorCode> = new Set([
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "UNEXPECTED_RESPONSE",
]);

export interface CreateWebshopParcelInput {
  commerceOrderId: string;
  /** A rendeles szama, ebbol lesz a referencia (`shipmentReference`). */
  displayId: number | string;
  carrier: CarrierCode;
  recipient: { name: string; phone: string; email: string };
  destination: ParcelDestination;
  size?: ParcelSize;
  codHuf?: number;
  /** Az utanvet hivatkozasa (a szamla sorszama), a szallitonak tovabbadva. */
  codReference?: string;
  /** A cimke szovege, a szallitonak tovabbadva. */
  labelContent?: string;
  /** A szallitonak szolo uzenet (Foxpost: `deliveryNote`). */
  courierNote?: string;
  createdByUserId?: string | null;
}

/** Amit a Rendelesek oldal lat egy rendeles csomagjarol. */
export interface WebshopParcelView {
  id: string;
  commerceOrderId: string;
  carrier: CarrierCode;
  reference: string;
  /** null: a letrehozas folyamatban van, vagy a kimenete bizonytalan. */
  parcelNumber: string | null;
  /** Alszolgaltatoi csomag (`STUB-`): nem valodi, levelbe nem mehet. */
  stub: boolean;
  size: string | null;
  codHuf: number | null;
  createdAt: Date;
}

const view = (row: WebshopParcel): WebshopParcelView => ({
  id: row.id,
  commerceOrderId: row.commerceOrderId,
  carrier: row.carrier as CarrierCode,
  reference: row.reference,
  parcelNumber: row.parcelNumber,
  stub: row.parcelNumber ? isStubParcelNumber(row.parcelNumber) : false,
  size: row.size,
  codHuf: row.codHuf,
  createdAt: row.createdAt,
});

/**
 * A WEBSHOP RENDELES CSOMAGJA (Foxpost prompt 13-18. pont; nautilus 26359).
 * Vegpontja nincs: a Rendelesek oldal (nautilus, 5. PR) hivja.
 *
 * A DUPLIKACIO-VED SORRENDJE: elobb a foglalas (az adatbazis reszleges egyedi
 * indexe enged egy ACTIVE sort rendelesenkent), UTANA a szallito hivasa. Igy
 * egy dupla kattintas vagy ujraprobalas masodik kerese mar a foglalason
 * bukik el, es a szallitohoz nem jut el. Az ujranyomtatas a meglevo csomagra
 * ker cimket, sosem hoz letre ujat.
 */
@Injectable()
export class WebshopParcelService {
  private readonly clients: CarrierClients;

  constructor(
    private readonly repository: WebshopParcelRepository,
    @Optional() @Inject(CARRIER_CLIENTS) clients?: CarrierClients,
  ) {
    this.clients = clients ?? ((carrier) => carrierClientFor(carrier));
  }

  async createParcel(
    input: CreateWebshopParcelInput,
  ): Promise<WebshopParcelView> {
    const reference = shipmentReference({ displayId: input.displayId });
    const reservation = await this.repository.reserve({
      commerceOrderId: input.commerceOrderId,
      carrier: input.carrier,
      reference,
      size: input.size ?? null,
      codHuf: input.codHuf ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
    if (!reservation) {
      const existing = await this.repository.findActive(input.commerceOrderId);
      const code =
        existing && !existing.parcelNumber ? "UNCONFIRMED" : "DUPLICATE";
      throw new CarrierError(
        code,
        (existing?.carrier as CarrierCode) ?? input.carrier,
      );
    }

    let parcel: ParcelRef;
    try {
      parcel = await this.clients(input.carrier).createParcel({
        reference,
        recipient: input.recipient,
        destination: input.destination,
        ...(input.size ? { size: input.size } : {}),
        ...(input.codHuf ? { codHuf: input.codHuf } : {}),
        ...(input.codReference ? { codReference: input.codReference } : {}),
        ...(input.labelContent ? { labelContent: input.labelContent } : {}),
        ...(input.courierNote ? { courierNote: input.courierNote } : {}),
      });
    } catch (error) {
      // csak a BIZTOS elutasitas engedi el a foglalast; ismeretlen hiba bizonytalan
      if (error instanceof CarrierError && !UNCERTAIN.has(error.code)) {
        await this.repository.dropReservation(reservation.id);
      }
      throw error;
    }
    return view(await this.repository.confirm(reservation.id, parcel));
  }

  /** Ujranyomtatas: a meglevo csomag cimkeje. Uj csomagot SOSEM hoz letre. */
  async labelPdf(commerceOrderId: string): Promise<Buffer> {
    const parcel = await this.confirmedParcel(commerceOrderId);
    return this.clients(parcel.carrier as CarrierCode).labelPdf({
      parcelNumber: parcel.parcelNumber!,
      carrierParcelId: parcel.carrierParcelId,
    });
  }

  async tracking(commerceOrderId: string): Promise<TrackingEvent[]> {
    const parcel = await this.confirmedParcel(commerceOrderId);
    return this.clients(parcel.carrier as CarrierCode).tracking({
      parcelNumber: parcel.parcelNumber!,
      carrierParcelId: parcel.carrierParcelId,
    });
  }

  /**
   * A csomag lemondasa: elobb a szallitonal, es csak ha ott sikerult, nalunk.
   * Ha a szallito nem engedi (pl. mar uton van), a sor ACTIVE marad.
   */
  async cancelParcel(commerceOrderId: string): Promise<void> {
    const parcel = await this.confirmedParcel(commerceOrderId);
    await this.clients(parcel.carrier as CarrierCode).cancelParcel({
      parcelNumber: parcel.parcelNumber!,
      carrierParcelId: parcel.carrierParcelId,
    });
    await this.repository.markCancelled(parcel.id);
  }

  /**
   * A bizonytalan foglalas feloldasa, KIFEJEZETT kezeloi lepeskent, miutan a
   * szallito feluleten megneztek, hogy nem jott letre csomag. Futo hivast nem
   * old fel (RESERVATION_RELEASE_AFTER_MS), kesz csomagot nem mond le.
   */
  async releaseUnconfirmed(commerceOrderId: string): Promise<void> {
    const parcel = await this.repository.findActive(commerceOrderId);
    if (!parcel) throw new CarrierError("NO_PARCEL", null);
    const carrier = parcel.carrier as CarrierCode;
    if (parcel.parcelNumber) throw new CarrierError("DUPLICATE", carrier);
    const olderThan = new Date(Date.now() - RESERVATION_RELEASE_AFTER_MS);
    const released = await this.repository.markCancelled(parcel.id, {
      unconfirmedOnly: true,
      olderThan,
    });
    if (!released) throw new CarrierError("UNCONFIRMED", carrier);
  }

  /** A lista oldal: az ACTIVE csomag rendelesenkent, egy lekerdezessel. */
  async activeParcelsFor(
    commerceOrderIds: string[],
  ): Promise<Record<string, WebshopParcelView>> {
    const rows = await this.repository.findActiveMany([
      ...new Set(commerceOrderIds),
    ]);
    return Object.fromEntries(
      rows.map((row) => [row.commerceOrderId, view(row)]),
    );
  }

  private async confirmedParcel(
    commerceOrderId: string,
  ): Promise<WebshopParcel> {
    const parcel = await this.repository.findActive(commerceOrderId);
    if (!parcel) throw new CarrierError("NO_PARCEL", null);
    if (!parcel.parcelNumber)
      throw new CarrierError("UNCONFIRMED", parcel.carrier as CarrierCode);
    return parcel;
  }
}
