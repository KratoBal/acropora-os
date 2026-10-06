/**
 * A FUVAROZOI KLIENSEK KOZOS FELULETE (acrobot 26354; a Foxpost prompt 13-18.
 * pontja). A FOXPOST es a GLS ugyanezt adja; a rendeles-oldal (nautilus,
 * Rendelesek 5. PR) csak ezt latja.
 *
 * ELES FIOKOT SEMMI NEM HIV ALAPBOL: a mod `stub` (alszolgaltato), es csak egy
 * kifejezett `live` beallitas visz a valodi szolgaltatohoz. A Foxpost Web API
 * eles fiokja valodi kuldemenyt hoz letre (store/.foxpost-credentials
 * fejlece), teszt-kulcsunk nincs.
 */
export type CarrierCode = "foxpost" | "gls";

/** FOXPOST csomagmeret (OpenAPI: CreateParcelRequest.size, "xs, s, m, l, xl"). */
export type ParcelSize = "xs" | "s" | "m" | "l" | "xl";

export type ParcelDestination =
  | { kind: "point"; pointId: string }
  | { kind: "home"; zip: string; city: string; address: string };

export interface CreateParcelInput {
  /**
   * A fuvarozoi referencia: a rendelesszam (Balazs, 2026-10-05). EGY helyen
   * allitjuk elo, a hivo oldalon (`shipmentReference`), nem itt.
   */
  reference: string;
  recipient: { name: string; phone: string; email: string };
  destination: ParcelDestination;
  /** Csak FOXPOST; ha nincs megadva, a szolgaltato alaperteke. */
  size?: ParcelSize;
  /** Utanvet osszege egesz forintban; ha nincs, nincs utanvet. */
  codHuf?: number;
  /**
   * Az utanvet hivatkozasa: a SZAMLA sorszama (Balazs GLS-beallitasa, emlek
   * 2109). Ha nincs megadva, a referencia (rendelesszam). A Foxpost nem kéri.
   */
  codReference?: string;
  /** A cimken allo szoveg: a rendelesazonosito (es kesobb a vevo megjegyzese). GLS: `Content`. */
  labelContent?: string;
  /**
   * A szallitonak szolo uzenet (commerce #493: a penztarban, legfeljebb 50
   * karakter, csak hazhoz szallitasnal). Foxpost: `deliveryNote` (a hazhoz
   * szallito futarnak, 50 karakter, a teszt-API leirasan merve, v1.2.14). GLS:
   * a cimke szovegebe kerul (`labelContent`), mert kulon mezo nincs ra.
   */
  courierNote?: string;
}

export interface TrackingEvent {
  status: string;
  statusText: string;
  at: Date | null;
}

/**
 * EGY LETREJOTT CSOMAG A SZALLITONAL. A `parcelNumber` a vevo es a kollega
 * szama (FOXPOST: CLFOX vonalkod, GLS: ParcelNumber). A `carrierParcelId` a
 * szallito belso azonositoja, ha a cimke ujrakeresehez vagy a torleshez az
 * kell (GLS: ParcelId; a MyGLS WSDL szerint a GetPrintedLabels es a
 * DeleteLabels ParcelIdList-et var, nem csomagszamot). FOXPOST-nal nincs.
 */
export interface ParcelRef {
  parcelNumber: string;
  carrierParcelId?: string | null;
}

export interface CarrierClient {
  readonly carrier: CarrierCode;
  createParcel(input: CreateParcelInput): Promise<ParcelRef>;
  labelPdf(parcel: ParcelRef): Promise<Buffer>;
  tracking(parcel: ParcelRef): Promise<TrackingEvent[]>;
  cancelParcel(parcel: ParcelRef): Promise<void>;
}

/**
 * A HIBA KODJA ES A FELHASZNALONAK SZOLO MONDAT (prompt 18. pont): a kollega
 * egy tennivalot lat, nem nyers szolgaltatoi valaszt. A technikai reszlet
 * (`detail`) csak naplozasra valo, a feluletre nem megy ki.
 */
export type CarrierErrorCode =
  | "NOT_CONFIGURED"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "INVALID_POINT"
  | "INVALID_ADDRESS"
  | "INVALID_SIZE"
  | "LABEL_FAILED"
  | "DUPLICATE"
  | "UNCONFIRMED"
  | "NO_PARCEL"
  | "REJECTED"
  | "UNEXPECTED_RESPONSE";

export const CARRIER_ERROR_MESSAGE: Record<CarrierErrorCode, string> = {
  NOT_CONFIGURED:
    "A szállító hozzáférése nincs beállítva. Szólj a rendszergazdának.",
  SERVICE_UNAVAILABLE:
    "A szállító rendszere most nem érhető el. Próbáld újra néhány perc múlva.",
  TIMEOUT:
    "A szállító nem válaszolt időben. Mielőtt újra próbálod, frissítsd az oldalt, mert a csomag közben létrejöhetett.",
  INVALID_POINT:
    "Érvénytelen átvételi pont. Frissítsd a pontot és próbáld újra.",
  INVALID_ADDRESS:
    "Hibás vagy hiányos szállítási cím vagy elérhetőség. Javítsd a rendelés adatait és próbáld újra.",
  INVALID_SIZE: "Érvénytelen csomagméret. Válassz másik méretet.",
  LABEL_FAILED:
    "A címke most nem készült el. A csomag létezik, a címkét próbáld újra letölteni.",
  DUPLICATE:
    "Ehhez a rendeléshez már tartozik csomag. Ne hozz létre duplikátumot.",
  UNCONFIRMED:
    "Ehhez a rendeléshez egy csomag létrehozása folyamatban van, vagy az eredménye bizonytalan. Várj egy percet és frissítsd az oldalt. Ha a csomagszám akkor sem jelenik meg, nézd meg a szállító felületén, létrejött-e, és csak utána engedd újra a létrehozást.",
  NO_PARCEL: "Ehhez a rendeléshez még nincs csomag.",
  REJECTED:
    "A szállító elutasította a csomagot. Ellenőrizd a rendelés adatait, és próbáld újra.",
  UNEXPECTED_RESPONSE:
    "A szállító válasza nem értelmezhető. A csomag létrejöhetett: mielőtt újra próbálod, nézd meg a szállító felületén.",
};

export class CarrierError extends Error {
  readonly userMessage: string;

  constructor(
    readonly code: CarrierErrorCode,
    /** null, ha a hiba nem egy szallitohoz kotodik (pl. nincs csomag). */
    readonly carrier: CarrierCode | null,
    readonly detail?: string,
  ) {
    super(`${carrier ?? "carrier"}:${code}`);
    this.name = "CarrierError";
    this.userMessage = CARRIER_ERROR_MESSAGE[code];
  }
}

/** A szolgaltato elerese: alszolgaltato, teszt-host vagy eles. */
export type CarrierMode = "stub" | "test" | "live";

export const carrierMode = (value: string | undefined): CarrierMode =>
  value === "test" || value === "live" ? value : "stub";
