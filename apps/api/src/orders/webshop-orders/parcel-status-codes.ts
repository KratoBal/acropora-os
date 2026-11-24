import type {
  CarrierMode,
  TrackingEvent,
} from "../../integrations/carriers/carrier.types.js";
import {
  observedFromTally,
  parcelErrorCode,
  tallyParcelEvents,
  type ObservedTally,
  type ParcelStatusSyncReport,
  type ParcelSyncCarrier,
} from "./webshop-parcel-status-sync.js";

/**
 * THE CARRIERS' STATUS CODES, OBSERVED ON REAL PARCELS (cards ef84489d and 17fe0cfd; acrobot 60378, 60381).
 *
 * The parcel status sync closes an order on a DELIVERED code, and which code that is is configuration
 * (`FOXPOST_DELIVERED_STATUS_CODES`, `GLS_DELIVERED_STATUS_CODES`), empty until someone has seen a real parcel
 * delivered. The OS itself makes parcels only for webshop orders, and the webshop is not live, so the sync has
 * nothing real to watch. Real parcel numbers are already in the database, from the carriers' own settlements
 * (`FoxpostSettlementLine.parcelBarcode`, `GlsInvoiceParcel.parcelNumber`): this asks the carrier's tracking for
 * the newest of them and counts the codes. It READS ONLY: tracking calls, no parcel made, nothing written.
 *
 * What leaves it is the same as the sync's observe mode, by the same rule (`observedFromTally`): codes, a short
 * description only where it repeats on several parcels, counts. No parcel number, name or address; a failure is a
 * code and a count.
 */
export const OBSERVE_DEFAULT_LIMIT = 20;
export const OBSERVE_MAX_LIMIT = 50;

export interface ParcelStatusCodeObservation {
  carrier: ParcelSyncCarrier;
  /** which carrier system answered: a stub never reaches here */
  mode: Exclude<CarrierMode, "stub">;
  /** distinct parcel numbers asked */
  asked: number;
  /** parcels the carrier answered with at least one event */
  answered: number;
  /** parcels the carrier answered with no event (for example too old) */
  empty: number;
  /** failed tracking calls, by error code */
  failed: { error: string; parcels: number }[];
  observed: ParcelStatusSyncReport["observed"];
}

export async function observeParcelStatusCodes(
  carrier: ParcelSyncCarrier,
  mode: Exclude<CarrierMode, "stub">,
  parcelNumbers: readonly string[],
  tracking: (parcelNumber: string) => Promise<TrackingEvent[]>,
): Promise<ParcelStatusCodeObservation> {
  const distinct = [
    ...new Set(parcelNumbers.map((n) => n.trim()).filter((n) => n !== "")),
  ];
  const seen: ObservedTally = new Map();
  const failed = new Map<string, number>();
  let answered = 0;
  let empty = 0;
  // one after another: a few dozen read calls, and no burst at the carrier
  for (const parcelNumber of distinct) {
    try {
      const events = await tracking(parcelNumber);
      if (events.length === 0) {
        empty += 1;
        continue;
      }
      answered += 1;
      tallyParcelEvents(seen, events);
    } catch (error) {
      const code = parcelErrorCode(error);
      failed.set(code, (failed.get(code) ?? 0) + 1);
    }
  }
  return {
    carrier,
    mode,
    asked: distinct.length,
    answered,
    empty,
    failed: [...failed]
      .map(([error, parcels]) => ({ error, parcels }))
      .sort((a, b) => b.parcels - a.parcels || a.error.localeCompare(b.error)),
    observed: observedFromTally(seen),
  };
}
