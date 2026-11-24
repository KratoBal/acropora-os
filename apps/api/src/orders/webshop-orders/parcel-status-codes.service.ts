import { ConflictException, Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { carrierClientFor } from "../../integrations/carriers/carrier-client.factory.js";
import {
  carrierMode,
  type CarrierClient,
} from "../../integrations/carriers/carrier.types.js";
import {
  observeParcelStatusCodes,
  type ParcelStatusCodeObservation,
} from "./parcel-status-codes.js";
import type { ParcelSyncCarrier } from "./webshop-parcel-status-sync.js";

/**
 * The newest parcel numbers the carriers' own settlements gave us, newest first, distinct, at most `limit`.
 * Foxpost: the monthly settlement lines (by transaction date); GLS: the invoices' parcel lines (by pickup date),
 * which list every parcel sent, not only the cash on delivery ones.
 */
export async function newestSettledParcelNumbers(
  carrier: ParcelSyncCarrier,
  limit: number,
): Promise<string[]> {
  // more rows than asked, so the duplicates (a parcel on two lines) still leave `limit` distinct numbers
  const take = limit * 3;
  const numbers =
    carrier === "foxpost"
      ? (
          await prisma.foxpostSettlementLine.findMany({
            where: { parcelBarcode: { not: null } },
            select: { parcelBarcode: true },
            orderBy: [{ transactionDate: "desc" }, { id: "asc" }],
            take,
          })
        ).map((row) => row.parcelBarcode ?? "")
      : (
          await prisma.glsInvoiceParcel.findMany({
            select: { parcelNumber: true },
            orderBy: [
              { pickupDate: { sort: "desc", nulls: "last" } },
              { id: "asc" },
            ],
            take,
          })
        ).map((row) => row.parcelNumber);
  return [
    ...new Set(numbers.map((n) => n.trim()).filter((n) => n !== "")),
  ].slice(0, limit);
}

/**
 * The read-only status code observer (cards ef84489d and 17fe0cfd). One run at a time, and only against a real
 * carrier system: in stub mode the stub's own codes would come back, which look like an answer and are not one.
 */
@Injectable()
export class ParcelStatusCodesService {
  /** the parcel numbers' source (a property, so a test replaces it without a database) */
  parcelNumbers: (
    carrier: ParcelSyncCarrier,
    limit: number,
  ) => Promise<string[]> = newestSettledParcelNumbers;
  /** the carrier client for the environment's mode (a property, so a test replaces it) */
  clientFor: (
    carrier: ParcelSyncCarrier,
    env: NodeJS.ProcessEnv,
  ) => CarrierClient = (carrier, env) => carrierClientFor(carrier, env);
  private running = false;

  async observe(
    carrier: ParcelSyncCarrier,
    limit: number,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<ParcelStatusCodeObservation> {
    // literal reads, as in carrierClientFor
    const mode = carrierMode(
      carrier === "foxpost" ? env.FOXPOST_API_MODE : env.GLS_API_MODE,
    );
    if (mode === "stub") {
      throw new ConflictException({
        code: "STUB_MODE",
        message: `A ${carrier} kapcsolat stub módban fut: a valódi kódokhoz test vagy live mód kell.`,
      });
    }
    if (this.running) {
      throw new ConflictException({
        code: "BUSY",
        message: "Egy megfigyelés már fut, várd meg a végét.",
      });
    }
    this.running = true;
    try {
      const client = this.clientFor(carrier, env);
      const numbers = await this.parcelNumbers(carrier, limit);
      return await observeParcelStatusCodes(carrier, mode, numbers, (n) =>
        client.tracking({ parcelNumber: n }),
      );
    } finally {
      this.running = false;
    }
  }
}
