import { createHash } from "node:crypto";

import {
  type CarrierClient,
  CarrierError,
  type CarrierMode,
  type CreateParcelInput,
  type ParcelRef,
  type TrackingEvent,
} from "./carrier.types.js";

/**
 * A MyGLS API KLIENSE (ParcelService, JSON). MA NEM HIVHATO: a MyGLS
 * felhasznalonev, jelszo es ugyfelszam HIANYZIK (acrobot 26358: a
 * store/.gls-credentials.json kulcsai nem a MyGLS belepeshez valok, 2026-09-14
 * merve: mindket hoston Unauthorized). Ezert a mod alapbol `stub`, es ez a
 * kliens csak beallitott belepessel indul.
 *
 * A FORRASOK, kulon:
 * - A muveletek es a mezok neve a hivatalos WSDL-bol
 *   (https://api.mygls.hu/ParcelService.svc?singleWsdl, letoltve 2026-10-05):
 *   APIRequestBase {Username, Password: base64Binary, ClientNumberList,
 *   WebshopEngine}; PrintLabels {ParcelList, TypeOfPrinter} ->
 *   {Labels, PrintLabelsInfoList[{ParcelId, ParcelNumber, ClientReference}],
 *   PrintLabelsErrorList[{ErrorCode, ErrorDescription}]}; GetPrintedLabels
 *   {ParcelIdList}; GetParcelStatuses {ParcelNumber, LanguageIsoCode,
 *   ReturnPOD}; DeleteLabels {ParcelIdList}; Parcel {ClientNumber,
 *   ClientReference, CODAmount, DeliveryAddress, ServiceList, Count}.
 * - A jelszo alakja (SHA512 lenyomat BAJT-TOMBKENT) es a JSON vegpontok
 *   (`/ParcelService.svc/json/<Muvelet>`) acrobot merese a
 *   gls-shipping-for-woocommerce forrasabol (26358), nem a WSDL-bol.
 * - A csomagpontos kezbesites a PSD szolgaltatas (WSDL: Service.PSDParameter,
 *   StringValue/IntegerValue). Hogy a pont azonositoja a StringValue-ba megy,
 *   az KOVETKEZTETES; a sandbox ellen elso hivasnal merni kell.
 * - NEM MERT: hogy a JSON torzs "csomagolt"-e (a WCF kerheti a muvelet nevevel
 *   korulvett alakot), es hogy a `TypeOfPrinter` milyen ertekeket fogad (a
 *   WSDL-ben csak szoveg; ezert nem kuldjuk, az alapertek marad). Mindkettot az
 *   elso sandbox-hivas donti el, belepessel.
 * - FIGYELEM: a MyGLS elutasitaskor is HTTP 200-at ad, a hiba a torzsben all
 *   (`...ErrorList[]` / `GetParcelStatusErrors[]`). Ezert minden valaszban a
 *   hibalistat nezzuk, nem csak a statuszkodot.
 */
export const GLS_API_URL: Record<Exclude<CarrierMode, "stub">, string> = {
  test: "https://api.test.mygls.hu/ParcelService.svc/json",
  live: "https://api.mygls.hu/ParcelService.svc/json",
};

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A FELADÁSI CÍM (Balázs GLS-beállítása, emlék 2109: 1106 Budapest, Pesti
 * Gábor utca 35.). Az alak MÉRT: acrobot élő próbacímkéje (3422774543,
 * 2026-10-05) pontosan ezzel ment át (acrobot 26533). Felülírható a
 * `GLS_PICKUP_*` környezeti változókkal.
 */
export interface GlsPickupAddress {
  Name: string;
  Street: string;
  HouseNumber: string;
  City: string;
  ZipCode: string;
  CountryIsoCode: string;
  ContactName: string;
  ContactPhone: string;
  ContactEmail: string;
}

export const GLS_DEFAULT_PICKUP: GlsPickupAddress = {
  Name: "Acropora Kft.",
  Street: "Pesti Gábor utca",
  HouseNumber: "35",
  City: "Budapest",
  ZipCode: "1106",
  CountryIsoCode: "HU",
  ContactName: "Acropora Webshop",
  ContactPhone: "+36305427184",
  ContactEmail: "webshop@acropora.hu",
};

export function glsPickupAddress(
  environment: NodeJS.ProcessEnv = process.env,
): GlsPickupAddress {
  const value = (key: string, fallback: string) =>
    environment[key]?.trim() || fallback;
  return {
    Name: value("GLS_PICKUP_NAME", GLS_DEFAULT_PICKUP.Name),
    Street: value("GLS_PICKUP_STREET", GLS_DEFAULT_PICKUP.Street),
    HouseNumber: value(
      "GLS_PICKUP_HOUSE_NUMBER",
      GLS_DEFAULT_PICKUP.HouseNumber,
    ),
    City: value("GLS_PICKUP_CITY", GLS_DEFAULT_PICKUP.City),
    ZipCode: value("GLS_PICKUP_ZIP", GLS_DEFAULT_PICKUP.ZipCode),
    CountryIsoCode: "HU",
    ContactName: value(
      "GLS_PICKUP_CONTACT_NAME",
      GLS_DEFAULT_PICKUP.ContactName,
    ),
    ContactPhone: value("GLS_PICKUP_PHONE", GLS_DEFAULT_PICKUP.ContactPhone),
    ContactEmail: value("GLS_PICKUP_EMAIL", GLS_DEFAULT_PICKUP.ContactEmail),
  };
}

export interface GlsApiConfig {
  baseUrl: string;
  username: string;
  password: string;
  clientNumber: number;
  /** Ha nincs megadva, a `GLS_DEFAULT_PICKUP`. */
  pickup?: GlsPickupAddress;
}

/**
 * Az utca és a házszám külön mezőben (a mért címke így ment). A „Fehérvári út
 * 24.” alakból a VÉGÉN álló számot választja le; ha nincs ilyen, az egész
 * utca marad, és a házszám üres.
 */
export function splitStreet(address: string): {
  Street: string;
  HouseNumber: string;
} {
  const trimmed = address.trim();
  const match = /^(.*\S)\s+(\d+[\w/.-]*)\.?$/u.exec(trimmed);
  return match
    ? { Street: match[1]!, HouseNumber: match[2]!.replace(/\.$/, "") }
    : { Street: trimmed, HouseNumber: "" };
}

/** WCF JSON dátum a mostani időből. */
const wcfNow = (now: Date) => `/Date(${now.getTime()})/`;

export function glsApiConfig(
  mode: Exclude<CarrierMode, "stub">,
  environment: NodeJS.ProcessEnv = process.env,
): GlsApiConfig | null {
  const username = environment.GLS_MYGLS_USERNAME?.trim();
  const password = environment.GLS_MYGLS_PASSWORD;
  const clientNumber = Number(environment.GLS_MYGLS_CLIENT_NUMBER?.trim());
  if (
    !username ||
    !password ||
    !Number.isInteger(clientNumber) ||
    clientNumber <= 0
  )
    return null;
  return {
    baseUrl: GLS_API_URL[mode],
    username,
    password,
    clientNumber,
    pickup: glsPickupAddress(environment),
  };
}

/** A jelszo SHA512 lenyomata bajt-tombkent (a JSON-ban szamok tombje). */
export const glsPasswordBytes = (password: string): number[] => [
  ...createHash("sha512").update(password, "utf8").digest(),
];

type GlsError = { ErrorCode?: number; ErrorDescription?: string };

/** A WCF JSON a bajt-tombot szamok tombjekent adja; egyes valaszok base64-kent. */
const bytesOf = (value: unknown): Buffer | null =>
  Array.isArray(value)
    ? Buffer.from(value as number[])
    : typeof value === "string" && value
      ? Buffer.from(value, "base64")
      : null;

/** WCF JSON datum: "/Date(1696500000000+0200)/". */
export const wcfDate = (value: unknown): Date | null => {
  const match =
    typeof value === "string" ? /\/Date\((-?\d+)/.exec(value) : null;
  return match ? new Date(Number(match[1])) : null;
};

/**
 * THE LABEL TEXT'S CEILING: 40 CHARACTERS, AND IT IS NOT MEASURED.
 *
 * MyGLS's own limit on `Content` is unknown here: its documentation
 * (api.mygls.hu) is not on the quarantine reader's allowlist, and acrobot
 * decided not to widen it (26572). 40 is a safe cut: the order number is
 * short, and the courier note the webshop may add is capped at 50 there. A
 * cut is better than a refusal, which would stop the parcel at the counter.
 */
export const GLS_LABEL_CONTENT_MAX = 40;

/** Cut by characters, not UTF-16 units, so an accent is never split. */
export function glsLabelContent(text: string): string {
  return Array.from(text.trim())
    .slice(0, GLS_LABEL_CONTENT_MAX)
    .join("")
    .trimEnd();
}

export class GlsApiClient implements CarrierClient {
  readonly carrier = "gls" as const;

  constructor(
    private readonly config: GlsApiConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private requireConfig(): GlsApiConfig {
    if (!this.config) throw new CarrierError("NOT_CONFIGURED", "gls");
    return this.config;
  }

  private async call<T>(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const config = this.requireConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${config.baseUrl}/${operation}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Username: config.username,
          Password: glsPasswordBytes(config.password),
          ClientNumberList: [config.clientNumber],
          WebshopEngine: "acropora-os",
          ...body,
        }),
      });
    } catch (cause) {
      const timeout = (cause as { name?: string })?.name === "AbortError";
      throw new CarrierError(
        timeout ? "TIMEOUT" : "SERVICE_UNAVAILABLE",
        "gls",
        `${operation}: ${String(cause)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 500) {
      throw new CarrierError(
        "SERVICE_UNAVAILABLE",
        "gls",
        `${operation}: HTTP ${response.status}`,
      );
    }
    if (!response.ok) {
      throw new CarrierError(
        "REJECTED",
        "gls",
        `${operation}: HTTP ${response.status}`,
      );
    }
    const parsed = (await response.json().catch(() => null)) as T | null;
    if (!parsed)
      throw new CarrierError(
        "UNEXPECTED_RESPONSE",
        "gls",
        `${operation}: no JSON`,
      );
    return parsed;
  }

  /** A 200-as valasz hibalistaja: az elso hiba a kodunk, a reszlet a naplora. */
  private throwIfErrors(
    operation: string,
    errors: GlsError[] | undefined,
    fallback: "REJECTED" | "LABEL_FAILED",
  ) {
    if (!errors?.length) return;
    const text = errors
      .map((e) => `${e.ErrorCode}: ${e.ErrorDescription}`)
      .join("; ");
    const unauthorized = errors.some((e) =>
      /unauthori[sz]ed|login|password/i.test(e.ErrorDescription ?? ""),
    );
    throw new CarrierError(
      unauthorized ? "NOT_CONFIGURED" : fallback,
      "gls",
      `${operation}: ${text}`,
    );
  }

  async createParcel(input: CreateParcelInput): Promise<ParcelRef> {
    const config = this.requireConfig();
    const recipient = {
      Name: input.recipient.name,
      ContactName: input.recipient.name,
      ContactPhone: input.recipient.phone,
      ContactEmail: input.recipient.email,
      CountryIsoCode: "HU",
    };
    /*
      A BALÁZS-BEÁLLÍTÁS (emlék 2109, UNAS-minta): házhoz CSAK FDS (rugalmas
      egyeztetés e-mailben, a vevő címével); csomagpontra PSD a ponttal (az
      UNAS-ban azért nem volt PSD, mert ott nem volt GLS-csomagpont; acrobot
      26519). Az utánvét hivatkozása a számla sorszáma, a címkén a
      rendelésazonosító (`Content`). A felvételi cím és dátum a mért címke
      alakja (acrobot 26533).
    */
    const parcel: Record<string, unknown> = {
      ClientNumber: config.clientNumber,
      ClientReference: input.reference,
      Count: 1,
      ...(input.labelContent
        ? { Content: glsLabelContent(input.labelContent) }
        : {}),
      PickupDate: wcfNow(new Date()),
      PickupAddress: config.pickup ?? GLS_DEFAULT_PICKUP,
      ...(input.codHuf
        ? {
            CODAmount: Math.round(input.codHuf),
            CODReference: input.codReference ?? input.reference,
          }
        : {}),
      DeliveryAddress:
        input.destination.kind === "home"
          ? {
              ...recipient,
              ZipCode: input.destination.zip,
              City: input.destination.city,
              ...splitStreet(input.destination.address),
            }
          : recipient,
      ServiceList:
        input.destination.kind === "point"
          ? [
              {
                Code: "PSD",
                PSDParameter: { StringValue: input.destination.pointId },
              },
            ]
          : [{ Code: "FDS", FDSParameter: { Value: input.recipient.email } }],
    };
    const answer = await this.call<{
      PrintLabelsInfoList?: { ParcelId?: number; ParcelNumber?: number }[];
      PrintLabelsErrorList?: GlsError[];
    }>("PrintLabels", { ParcelList: [parcel] });
    this.throwIfErrors("PrintLabels", answer.PrintLabelsErrorList, "REJECTED");
    const info = answer.PrintLabelsInfoList?.[0];
    if (!info?.ParcelNumber) {
      throw new CarrierError(
        "UNEXPECTED_RESPONSE",
        "gls",
        "PrintLabels: no ParcelNumber",
      );
    }
    return {
      parcelNumber: String(info.ParcelNumber),
      carrierParcelId: info.ParcelId ? String(info.ParcelId) : null,
    };
  }

  async labelPdf(parcel: ParcelRef): Promise<Buffer> {
    if (!parcel.carrierParcelId) {
      throw new CarrierError(
        "LABEL_FAILED",
        "gls",
        "GetPrintedLabels needs the ParcelId",
      );
    }
    const answer = await this.call<{
      Labels?: unknown;
      GetPrintedLabelsErrorList?: GlsError[];
    }>("GetPrintedLabels", { ParcelIdList: [Number(parcel.carrierParcelId)] });
    this.throwIfErrors(
      "GetPrintedLabels",
      answer.GetPrintedLabelsErrorList,
      "LABEL_FAILED",
    );
    const pdf = bytesOf(answer.Labels);
    if (!pdf || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new CarrierError(
        "LABEL_FAILED",
        "gls",
        "GetPrintedLabels: the label is not a PDF",
      );
    }
    return pdf;
  }

  async tracking(parcel: ParcelRef): Promise<TrackingEvent[]> {
    const answer = await this.call<{
      ParcelStatusList?: {
        StatusCode?: string;
        StatusDate?: string;
        StatusDescription?: string;
      }[];
      GetParcelStatusErrors?: GlsError[];
    }>("GetParcelStatuses", {
      ParcelNumber: Number(parcel.parcelNumber),
      ReturnPOD: false,
      LanguageIsoCode: "HU",
    });
    this.throwIfErrors(
      "GetParcelStatuses",
      answer.GetParcelStatusErrors,
      "REJECTED",
    );
    return (answer.ParcelStatusList ?? []).map((status) => ({
      status: status.StatusCode ?? "",
      statusText: status.StatusDescription ?? status.StatusCode ?? "",
      at: wcfDate(status.StatusDate),
    }));
  }

  async cancelParcel(parcel: ParcelRef): Promise<void> {
    if (!parcel.carrierParcelId) {
      throw new CarrierError(
        "REJECTED",
        "gls",
        "DeleteLabels needs the ParcelId",
      );
    }
    const answer = await this.call<{ DeleteLabelsErrorList?: GlsError[] }>(
      "DeleteLabels",
      {
        ParcelIdList: [Number(parcel.carrierParcelId)],
      },
    );
    this.throwIfErrors(
      "DeleteLabels",
      answer.DeleteLabelsErrorList,
      "REJECTED",
    );
  }
}
