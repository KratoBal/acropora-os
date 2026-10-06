import {
  type CarrierClient,
  CarrierError,
  type CarrierErrorCode,
  type CarrierMode,
  type CreateParcelInput,
  type ParcelRef,
  type TrackingEvent,
} from "./carrier.types.js";

/**
 * A FOXPOST WEB API KLIENSE (FoxWeb API 1.2.14; a hivatalos OpenAPI:
 * https://webapi.foxpost.hu/v3/api-docs, a teszt-host:
 * https://webapi-test.foxpost.hu/v3/api-docs, letoltve 2026-10-05).
 *
 * A HASZNALT HIVASOK, a leiras szerint:
 *   POST   /api/parcel            CreateParcelRequest[]  -> CreateResponse (201)
 *   POST   /api/label/{A6}        ["<barcode>"]          -> application/pdf
 *   GET    /api/tracking/{barcode}                       -> Tracking
 *   DELETE /api/parcel/{barcode}                         -> 200 / 204
 * Hitelesites: HTTP Basic (az e-kereskedelmi kod es jelszo) ES `api-key` fejlec
 * (store/.foxpost-credentials: ecomm_kod, ecomm_jelszo, ecomm_api_kulcs).
 *
 * MERT ES KOVETKEZTETETT, kulon:
 * - A `barcode` mezonevet acrobot merte elesen, OLVASO hivassal egy mar
 *   letezo csomagra (2026-10-05, 26358): GET /api/label/info/{barcode} es
 *   GET /api/tracking/{barcode} valasza. A LETREHOZAS valaszaban a csomag
 *   elemei (`Package`) a leirasban ures objektumkent allnak; ott a `barcode`
 *   kulcsot KOVETKEZTETESKENT keressuk. Ha nincs, hangos hiba
 *   (UNEXPECTED_RESPONSE), es a naplo csak a kulcsneveket kapja meg.
 * - A tracking valasz kulcsait (clFox, traces[{statusDate, shortName,
 *   longName, status}], ...) ugyanaz a meres adta.
 */
export const FOXPOST_API_URL: Record<Exclude<CarrierMode, "stub">, string> = {
  test: "https://webapi-test.foxpost.hu",
  live: "https://webapi.foxpost.hu",
};

const REQUEST_TIMEOUT_MS = 20_000;

export interface FoxpostApiConfig {
  baseUrl: string;
  user: string;
  password: string;
  apiKey: string;
}

/** A beallitas a kornyezetbol; hianyzo kulcsnal null (nem dobas: allapot). */
export function foxpostApiConfig(
  mode: Exclude<CarrierMode, "stub">,
  environment: NodeJS.ProcessEnv = process.env,
): FoxpostApiConfig | null {
  const user = environment.FOXPOST_API_USER?.trim();
  const password = environment.FOXPOST_API_PASSWORD?.trim();
  const apiKey = environment.FOXPOST_API_KEY?.trim();
  if (!user || !password || !apiKey) return null;
  return { baseUrl: FOXPOST_API_URL[mode], user, password, apiKey };
}

type Logger = { warn(message: string): void };

/**
 * A szolgaltato hibajabol a mi kodunk. A mezo-hiba (FieldError {field,
 * message} a leirasban) a mezo neve alapjan kap kodot; minden mas
 * REJECTED, a technikai reszlet csak naplozasra.
 */
export function foxpostFieldErrorCode(
  field: string | undefined,
): CarrierErrorCode {
  const f = (field ?? "").toLowerCase();
  if (f === "destination") return "INVALID_POINT";
  if (f === "size") return "INVALID_SIZE";
  if (f.startsWith("recipient")) return "INVALID_ADDRESS";
  return "REJECTED";
}

export class FoxpostApiClient implements CarrierClient {
  readonly carrier = "foxpost" as const;

  constructor(
    private readonly config: FoxpostApiConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly logger: Logger = console,
  ) {}

  private requireConfig(): FoxpostApiConfig {
    if (!this.config) throw new CarrierError("NOT_CONFIGURED", "foxpost");
    return this.config;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const config = this.requireConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`,
          "api-key": config.apiKey,
        },
      });
    } catch (cause) {
      const timeout = (cause as { name?: string })?.name === "AbortError";
      throw new CarrierError(
        timeout ? "TIMEOUT" : "SERVICE_UNAVAILABLE",
        "foxpost",
        String(cause),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async failure(
    response: Response,
    what: string,
  ): Promise<CarrierError> {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      return new CarrierError(
        "NOT_CONFIGURED",
        "foxpost",
        `${what}: HTTP ${response.status}`,
      );
    }
    if (response.status >= 500) {
      return new CarrierError(
        "SERVICE_UNAVAILABLE",
        "foxpost",
        `${what}: HTTP ${response.status}`,
      );
    }
    // ApiError {timestamp, error, status}: a szoveg naplozasra megy, a feluletre nem
    return new CarrierError(
      "REJECTED",
      "foxpost",
      `${what}: HTTP ${response.status} ${body.slice(0, 300)}`,
    );
  }

  async createParcel(input: CreateParcelInput): Promise<ParcelRef> {
    const request: Record<string, unknown> = {
      recipientName: input.recipient.name,
      recipientPhone: input.recipient.phone,
      recipientEmail: input.recipient.email,
      refCode: input.reference,
      ...(input.size ? { size: input.size } : {}),
      ...(input.codHuf ? { cod: Math.round(input.codHuf) } : {}),
      ...(input.destination.kind === "point"
        ? { destination: input.destination.pointId }
        : {
            recipientZip: input.destination.zip,
            recipientCity: input.destination.city,
            recipientAddress: input.destination.address,
            // a hazhoz szallito futarnak; a mezo 50 karakteres (teszt-API, v1.2.14)
            ...(input.courierNote
              ? {
                  deliveryNote: Array.from(input.courierNote.trim())
                    .slice(0, 50)
                    .join(""),
                }
              : {}),
          }),
    };

    const response = await this.request("/api/parcel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([request]),
    });
    if (!response.ok) throw await this.failure(response, "createParcel");

    const body = (await response.json().catch(() => null)) as {
      valid?: boolean;
      parcels?: Record<string, unknown>[];
    } | null;
    const parcel = body?.parcels?.[0];
    const errors =
      (parcel?.errors as { field?: string; message?: string }[] | undefined) ??
      [];
    if (body?.valid === false || errors.length) {
      const first = errors[0];
      throw new CarrierError(
        foxpostFieldErrorCode(first?.field),
        "foxpost",
        `createParcel invalid: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
    const barcode = parcel?.barcode;
    if (typeof barcode !== "string" || !barcode.trim()) {
      // a kulcsnevek mennek a naplora, ertek (szemelyes adat) nem
      this.logger.warn(
        `Foxpost createParcel: no barcode in the answer; keys: ${Object.keys(parcel ?? body ?? {}).join(", ")}`,
      );
      throw new CarrierError(
        "UNEXPECTED_RESPONSE",
        "foxpost",
        "no barcode in the create answer",
      );
    }
    return { parcelNumber: barcode.trim() };
  }

  async labelPdf({ parcelNumber }: ParcelRef): Promise<Buffer> {
    const response = await this.request("/api/label/A6", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify([parcelNumber]),
    });
    if (!response.ok) {
      const error = await this.failure(response, "labelPdf");
      throw error.code === "REJECTED"
        ? new CarrierError("LABEL_FAILED", "foxpost", error.detail)
        : error;
    }
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new CarrierError(
        "LABEL_FAILED",
        "foxpost",
        "the label answer is not a PDF",
      );
    }
    return pdf;
  }

  async tracking({ parcelNumber }: ParcelRef): Promise<TrackingEvent[]> {
    const response = await this.request(
      `/api/tracking/${encodeURIComponent(parcelNumber)}`,
      {
        method: "GET",
      },
    );
    if (!response.ok) throw await this.failure(response, "tracking");
    const body = (await response.json().catch(() => null)) as {
      traces?: {
        statusDate?: string;
        shortName?: string;
        longName?: string;
        status?: string;
      }[];
    } | null;
    return (body?.traces ?? []).map((trace) => ({
      status: trace.status ?? "",
      statusText: trace.longName || trace.shortName || trace.status || "",
      at: trace.statusDate ? new Date(trace.statusDate) : null,
    }));
  }

  async cancelParcel({ parcelNumber }: ParcelRef): Promise<void> {
    const response = await this.request(
      `/api/parcel/${encodeURIComponent(parcelNumber)}`,
      {
        method: "DELETE",
      },
    );
    if (!response.ok) throw await this.failure(response, "cancelParcel");
  }
}
