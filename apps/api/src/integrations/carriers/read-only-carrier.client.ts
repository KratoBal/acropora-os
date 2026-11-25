import {
  CarrierError,
  type CarrierClient,
  type CarrierCode,
  type ParcelRef,
  type TrackingEvent,
} from "./carrier.types.js";

/**
 * THE READ-ONLY CARRIER (card 6ae05968; acrobot 61316, a decision without Balázs: the live mode is not switched on, because the
 * Csomag button would open REAL shipments). The mode `live-read` reaches the carrier's LIVE system ONLY for the tracking (the status
 * code observer, the status sync), and refuses everything else with a named reason (`READ_ONLY`, a 409) before anything is called.
 * The label too (barracuda on #2842): the Foxpost label is a POST (/api/label/A6) whose effect on the shipment was never measured,
 * and in this mode the OS has no parcel row whose label it would ask for, so letting it through would be risk without use.
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

  labelPdf(): Promise<Buffer> {
    return Promise.reject(new CarrierError("READ_ONLY", this.live.carrier));
  }

  tracking(parcel: ParcelRef): Promise<TrackingEvent[]> {
    return this.live.tracking(parcel);
  }
}
