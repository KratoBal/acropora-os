import {
  CarrierError,
  type CarrierClient,
  type CarrierCode,
  type ParcelRef,
  type TrackingEvent,
} from "./carrier.types.js";

/**
 * THE READ-ONLY CARRIER (card 6ae05968; acrobot 61316, a decision without Balázs: the live mode is not switched on, because the
 * Csomag button would open REAL shipments). The mode `live-read` reaches the carrier's LIVE system for what only reads (the
 * tracking, so the status code observer and the status sync, and an existing parcel's label), and refuses what would create or
 * cancel a shipment there, with a named reason (`READ_ONLY`, a 409) before anything is called.
 */
export class ReadOnlyCarrierClient implements CarrierClient {
  constructor(private readonly live: CarrierClient) {}

  get carrier(): CarrierCode {
    return this.live.carrier;
  }

  createParcel(): Promise<ParcelRef> {
    return Promise.reject(new CarrierError("READ_ONLY", this.live.carrier));
  }

  cancelParcel(): Promise<void> {
    return Promise.reject(new CarrierError("READ_ONLY", this.live.carrier));
  }

  labelPdf(parcel: ParcelRef): Promise<Buffer> {
    return this.live.labelPdf(parcel);
  }

  tracking(parcel: ParcelRef): Promise<TrackingEvent[]> {
    return this.live.tracking(parcel);
  }
}
