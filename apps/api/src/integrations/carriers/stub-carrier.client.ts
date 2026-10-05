import { createHash } from "node:crypto";

import type {
  CarrierClient,
  CarrierCode,
  CreateParcelInput,
  ParcelRef,
  TrackingEvent,
} from "./carrier.types.js";

/**
 * AZ ALSZOLGALTATO (a mod alaperteke, `stub`): semmit nem hiv, es a valasza
 * FELISMERHETO. A csomagszam `STUB-` elotagu (nautilus 26359), hogy
 * staging-en se latszodjon valodinak, es a "Feladtuk" levelbe (#477) se
 * kerulhessen kovetesi szamkent. Ugyanarra a referenciara ugyanazt adja,
 * tehat a tesztek es egy ujraprobalt kattintas determinisztikus.
 */
export const STUB_PARCEL_PREFIX = "STUB-";

export const isStubParcelNumber = (parcelNumber: string): boolean =>
  parcelNumber.startsWith(STUB_PARCEL_PREFIX);

/** Egy ures, egyoldalas, ervenyes PDF: a cimke helyett, felirat nelkul. */
const STUB_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 298 420]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

export class StubCarrierClient implements CarrierClient {
  constructor(readonly carrier: CarrierCode) {}

  async createParcel(input: CreateParcelInput): Promise<ParcelRef> {
    const digest = createHash("sha256")
      .update(`${this.carrier}:${input.reference}`)
      .digest("hex")
      .slice(0, 12)
      .toUpperCase();
    return {
      parcelNumber: `${STUB_PARCEL_PREFIX}${this.carrier.toUpperCase()}-${digest}`,
    };
  }

  async labelPdf(): Promise<Buffer> {
    return STUB_PDF;
  }

  async tracking(): Promise<TrackingEvent[]> {
    return [
      {
        status: "STUB",
        statusText: "Álszolgáltató: nincs valódi küldemény",
        at: null,
      },
    ];
  }

  async cancelParcel(): Promise<void> {}
}
