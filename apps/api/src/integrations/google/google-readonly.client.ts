/**
 * A GOOGLE-FIÓK, CSAK OLVASVA: Gmail-mellékletek és egy Drive-mappa PDF-jei.
 *
 * A számla-begyűjtés (kártya 3e75c2f4) több fiókot olvas (info@, balazs@) és
 * egy Drive-mappát, ezért ez a kliens a kulcsot és a fiókot PARAMÉTERKÉNT
 * kapja, nem egy rögzített környezeti változóból. A Foxpost, a GLS, a
 * SimplePay és a Várható beérkezések kliense ugyanezt a három hívást végzi
 * (kulcscsere, keresés, letöltés) a saját beállításaival; ez az első, amelyik
 * nem köt fiókot, tehát egy következő fiók nem hozna újabb másolatot.
 *
 * Csak olvasó hatókör kell hozzá (gmail.readonly, drive.readonly). Hibánál a
 * kód egy KÓDOT dob, soha nem a válasz szövegét: abban a Google visszaírhatja a
 * kérés részleteit, és a hiba a naplóba kerül.
 */

export interface GoogleReadonlyCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleReadonlySettings {
  credentials: GoogleReadonlyCredentials;
  gmailApiUrl?: string;
  driveApiUrl?: string;
  tokenUrl?: string;
  /** A rate limit utáni várakozások, egymás után; a hosszuk a próbák száma. */
  rateLimitDelaysMs?: readonly number[];
  /** A várakozás (a tesztben azonnali). */
  sleep?: (ms: number) => Promise<void>;
}

export class GoogleReadonlyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GoogleReadonlyError";
  }
}

/** Belső jel: a hívás rate limitbe futott, és újrapróbálható. */
class GoogleRateLimit extends Error {
  constructor(readonly retryAfterMs: number) {
    super("GOOGLE_RATE_LIMITED");
  }
}

/** Egy levél PDF-mellékletei, a fejlécek közül csak ami a tároláshoz kell. */
export interface GmailPdfMessage {
  id: string;
  receivedAt: Date | null;
  subject: string | null;
  sender: string | null;
  pdfs: Array<{ fileName: string; buffer: Buffer }>;
}

export interface DrivePdfFile {
  id: string;
  name: string;
  modifiedAt: Date | null;
  sizeBytes: number | null;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_DRIVE_API_URL = "https://www.googleapis.com/drive/v3";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Egy számla-PDF felső határa; a Hiányzó számlák feltöltésével azonos. */
export const GOOGLE_PDF_MAX_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * RATE LIMIT UTÁN RÖVID, KORLÁTOS VISSZAVÁRÁS (Balázs éles próbája, 2026-10-01:
 * az info@ és a balazs@ egy perc munka után állt le). Három próba, 1, 2, 4
 * másodperc; a Google `Retry-After` fejlécét is figyelembe vesszük, de legfeljebb
 * 10 másodpercig. Ennyi után a hiba megy tovább (GOOGLE_RATE_LIMITED), a
 * következő futás folytatja.
 */
const RATE_LIMIT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
const RETRY_AFTER_CAP_MS = 10_000;

/**
 * EGY 403 NEM MIND HITELESÍTÉSI HIBA. A Gmail a sebesség-korlátot is 403-mal
 * adhatja (`rateLimitExceeded`, `userRateLimitExceeded`), és azt eddig
 * GOOGLE_AUTH_FAILED-nek neveztük: a forrás leállt, holott a kulcs jó volt.
 *
 * A TÖRZS ALAKJA NEM MÉRT: a Google általános hibaformája szerint olvassuk
 * (`error.errors[].reason`, a régebbi alak, és `error.details[].reason`, az
 * újabb). Valódi rate-limit 403-at nem tudtunk előidézni, és Gmail kulcs a
 * fejlesztői gépen nincs. EZÉRT AZ IRÁNY ÓVATOS: csak az a 403 rate limit,
 * amelyik törzsében rate-limit ok áll; minden más (üres, más alakú, más ok)
 * marad GOOGLE_AUTH_FAILED, vagyis a régi viselkedés. Egy félreolvasás így
 * legfeljebb a mai állapotot adja, sosem nevez egy valódi jogosultsági hibát
 * átmenetinek.
 */
const RATE_LIMIT_REASON =
  /^(rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED)$/;

const forbiddenIsRateLimit = (body: unknown): boolean => {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  if (!error || typeof error !== "object") return false;
  const reasons = [
    ...((Array.isArray(error.errors) ? error.errors : []) as Array<{
      reason?: unknown;
    }>),
    ...((Array.isArray(error.details) ? error.details : []) as Array<{
      reason?: unknown;
    }>),
  ].map((entry) => entry?.reason);
  return reasons.some(
    (reason) => typeof reason === "string" && RATE_LIMIT_REASON.test(reason),
  );
};
const MAX_PAGES = 10;

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
    "base64",
  );
}

function allParts(root: GmailPart | undefined): GmailPart[] {
  if (!root) return [];
  return [root, ...(root.parts ?? []).flatMap((part) => allParts(part))];
}

/** A fájlnév is számít: van szállító, aki `application/octet-stream`-ként küldi. */
function isPdf(part: GmailPart): boolean {
  return (
    Boolean(part.filename) &&
    (part.filename!.toLowerCase().endsWith(".pdf") ||
      part.mimeType === "application/pdf")
  );
}

/** `Név <cím@gép>` vagy puszta cím, kisbetűvel. */
function senderAddress(from: string | null): string | null {
  if (!from) return null;
  const address =
    /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ??
    /([^\s<>"]+@[^\s<>"]+)/.exec(from)?.[1];
  return address ? address.toLowerCase() : null;
}

export class GoogleReadonlyClient {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly gmailApiUrl: string;
  private readonly driveApiUrl: string;
  private readonly tokenUrl: string;

  constructor(
    private readonly settings: GoogleReadonlySettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.gmailApiUrl = (settings.gmailApiUrl ?? DEFAULT_GMAIL_API_URL).replace(
      /\/$/,
      "",
    );
    this.driveApiUrl = (settings.driveApiUrl ?? DEFAULT_DRIVE_API_URL).replace(
      /\/$/,
      "",
    );
    this.tokenUrl = settings.tokenUrl ?? DEFAULT_TOKEN_URL;
  }

  /** A keresésnek megfelelő levelek azonosítói, legfeljebb `MAX_PAGES` lapon. */
  async gmailMessageIds(user: string, query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${this.gmailApiUrl}/users/${encodeURIComponent(user)}/messages`,
      );
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.json<{
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      }>(url);
      ids.push(...(response.messages ?? []).map((message) => message.id));
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  }

  /**
   * Egy levél a PDF-mellékleteivel. A túl nagy melléklet nem állítja meg a
   * levelet: kimarad, és a hívó a `skippedTooLarge` számból látja.
   */
  async gmailPdfMessage(
    user: string,
    messageId: string,
  ): Promise<GmailPdfMessage & { skippedTooLarge: number }> {
    const base = `${this.gmailApiUrl}/users/${encodeURIComponent(user)}/messages/${encodeURIComponent(messageId)}`;
    const message = await this.json<{
      id: string;
      internalDate?: string;
      payload?: GmailPart;
    }>(new URL(`${base}?format=full`));
    const header = (name: string) =>
      message.payload?.headers
        ?.find((h) => h.name?.toLowerCase() === name)
        ?.value?.trim() || null;
    const pdfs: GmailPdfMessage["pdfs"] = [];
    let skippedTooLarge = 0;
    for (const part of allParts(message.payload).filter(isPdf)) {
      if ((part.body?.size ?? 0) > GOOGLE_PDF_MAX_BYTES) {
        skippedTooLarge++;
        continue;
      }
      const encoded =
        part.body?.data ??
        (part.body?.attachmentId
          ? (
              await this.json<{ data?: string }>(
                new URL(
                  `${base}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
                ),
              )
            ).data
          : undefined);
      if (!encoded) continue;
      const buffer = decodeBase64Url(encoded);
      if (buffer.length > GOOGLE_PDF_MAX_BYTES) {
        skippedTooLarge++;
        continue;
      }
      pdfs.push({ fileName: part.filename!, buffer });
    }
    const internalDate = Number(message.internalDate);
    return {
      id: message.id,
      receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : null,
      subject: header("subject"),
      sender: senderAddress(header("from")),
      pdfs,
      skippedTooLarge,
    };
  }

  /** A mappa (nem kukázott) PDF-jei; almappába nem megy le. */
  async driveFolderPdfs(folderId: string): Promise<DrivePdfFile[]> {
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(folderId))
      throw new GoogleReadonlyError("GOOGLE_DRIVE_FOLDER_ID_INVALID");
    const files: DrivePdfFile[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${this.driveApiUrl}/files`);
      url.searchParams.set(
        "q",
        `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
      );
      url.searchParams.set(
        "fields",
        "nextPageToken, files(id, name, modifiedTime, size)",
      );
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.json<{
        files?: Array<{
          id: string;
          name: string;
          modifiedTime?: string;
          size?: string;
        }>;
        nextPageToken?: string;
      }>(url);
      for (const file of response.files ?? [])
        files.push({
          id: file.id,
          name: file.name,
          modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
          sizeBytes: file.size === undefined ? null : Number(file.size),
        });
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
    return files;
  }

  async driveFile(fileId: string): Promise<Buffer> {
    const url = new URL(
      `${this.driveApiUrl}/files/${encodeURIComponent(fileId)}`,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.request(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > GOOGLE_PDF_MAX_BYTES)
      throw new GoogleReadonlyError("GOOGLE_FILE_TOO_LARGE");
    return buffer;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
      return this.accessToken.value;
    const { clientId, clientSecret, refreshToken } = this.settings.credentials;
    const response = await this.fetchWithTimeout(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token)
      throw new GoogleReadonlyError("GOOGLE_TOKEN_INVALID");
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  private async json<T>(url: URL): Promise<T> {
    return (await (await this.request(url)).json()) as T;
  }

  private async request(url: URL): Promise<Response> {
    return this.fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
  }

  private async fetchWithTimeout(
    url: URL | string,
    init: RequestInit,
  ): Promise<Response> {
    const delays = this.settings.rateLimitDelaysMs ?? RATE_LIMIT_DELAYS_MS;
    const sleep =
      this.settings.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchOnce(url, init);
      } catch (error) {
        const retry =
          error instanceof GoogleRateLimit && attempt < delays.length;
        if (!retry) {
          throw error instanceof GoogleRateLimit
            ? new GoogleReadonlyError("GOOGLE_RATE_LIMITED")
            : error;
        }
        await sleep(Math.max(delays[attempt]!, error.retryAfterMs));
      }
    }
  }

  private async fetchOnce(
    url: URL | string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            forbiddenIsRateLimit(await response.json().catch(() => null)));
        if (rateLimited) {
          const seconds = Number(response.headers.get("retry-after"));
          throw new GoogleRateLimit(
            Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
              : 0,
          );
        }
        throw new GoogleReadonlyError(
          response.status === 401 || response.status === 403
            ? "GOOGLE_AUTH_FAILED"
            : `GOOGLE_HTTP_${response.status}`,
        );
      }
      return response;
    } catch (error) {
      if (
        error instanceof GoogleReadonlyError ||
        error instanceof GoogleRateLimit
      )
        throw error;
      throw new GoogleReadonlyError(
        error instanceof DOMException && error.name === "AbortError"
          ? "GOOGLE_TIMEOUT"
          : "GOOGLE_NETWORK_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
