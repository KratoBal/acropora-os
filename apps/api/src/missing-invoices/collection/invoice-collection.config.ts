/**
 * A SZÁMLA-BEGYŰJTÉS BEÁLLÍTÁSAI (kártya 3e75c2f4), EGY HELYEN. Ugyanaz az
 * alak, mint a többi behúzásé (`supplier-invoice-mail.config.ts`): egy kapcsoló,
 * ami se nem igaz, se nem hamis, felismeretlenként jelenik meg, nem csendben
 * kikapcsoltként.
 *
 *   INVOICE_COLLECTION_ENABLED        true / false; KI, ha nincs megadva
 *   INVOICE_COLLECTION_INFO_USER      alapból info@acropora.hu; a kulcsa a
 *                                     meglévő info@ kulcs (GMAIL_SUPPLIER_INVOICE_*,
 *                                     GMAIL_GLS_*, GMAIL_FOXPOST_*)
 *   GMAIL_BALAZS_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN
 *                                     a balazs@ fiók SAJÁT, csak olvasó kulcsa;
 *                                     üresen a fiók kimarad (Balázs jóváhagyó
 *                                     linkjére vár, emlék 1959)
 *   INVOICE_COLLECTION_BALAZS_USER    alapból balazs@acropora.hu
 *   GOOGLE_DRIVE_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN
 *                                     a Drive-mappa csak olvasó kulcsa; üresen
 *                                     a mappa kimarad
 *   MISSING_INVOICES_DRIVE_FOLDER_URL a mappa; ugyanaz, amit a drawer „Drive
 *                                     mappa megnyitása” gombja nyit, tehát a
 *                                     kettő nem mutathat máshová
 *   INVOICE_COLLECTION_DAYS           hány napra visszamenőleg (7..400, alap 150)
 *   INVOICE_COLLECTION_INTERVAL_MINUTES  alap 60 (5..1440)
 */
import type { GoogleReadonlyCredentials } from "../../integrations/google/google-readonly.client.js";
import {
  supplierInvoiceMailCredentials,
  supplierInvoiceMailSwitch,
  type SupplierInvoiceMailSwitch,
} from "../../purchasing/expected-arrivals/supplier-invoice-mail.config.js";

export const INVOICE_COLLECTION_SOURCES = [
  "INFO_MAIL",
  "BALAZS_MAIL",
  "DRIVE",
] as const;
export type InvoiceCollectionSource =
  (typeof INVOICE_COLLECTION_SOURCES)[number];

export type InvoiceCollectionSourceConfig =
  | {
      source: "INFO_MAIL" | "BALAZS_MAIL";
      credentials: GoogleReadonlyCredentials;
      user: string;
    }
  | {
      source: "DRIVE";
      credentials: GoogleReadonlyCredentials;
      folderId: string;
    };

export function invoiceCollectionSwitch(
  environment: NodeJS.ProcessEnv = process.env,
): SupplierInvoiceMailSwitch {
  return supplierInvoiceMailSwitch(environment.INVOICE_COLLECTION_ENABLED);
}

function credentials(
  environment: NodeJS.ProcessEnv,
  prefix: string,
): GoogleReadonlyCredentials | null {
  const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
  const refreshToken = environment[`${prefix}_REFRESH_TOKEN`]?.trim();
  return clientId && clientSecret && refreshToken
    ? { clientId, clientSecret, refreshToken }
    : null;
}

/** A mappa azonosítója a megosztási linkből (`.../folders/<id>`), vagy null. */
export function driveFolderId(url: string | undefined): string | null {
  const id = /\/folders\/([A-Za-z0-9_-]{10,128})(?:[/?#]|$)/.exec(
    url?.trim() ?? "",
  )?.[1];
  return id ?? null;
}

/** A beállított források; ami kulcs nélkül áll, az kimarad, és a leírás megnevezi. */
export function invoiceCollectionSources(
  environment: NodeJS.ProcessEnv = process.env,
): InvoiceCollectionSourceConfig[] {
  const sources: InvoiceCollectionSourceConfig[] = [];
  const info = supplierInvoiceMailCredentials(environment);
  if (info)
    sources.push({
      source: "INFO_MAIL",
      credentials: {
        clientId: info.clientId,
        clientSecret: info.clientSecret,
        refreshToken: info.refreshToken,
      },
      user:
        environment.INVOICE_COLLECTION_INFO_USER?.trim() || "info@acropora.hu",
    });
  const balazs = credentials(environment, "GMAIL_BALAZS");
  if (balazs)
    sources.push({
      source: "BALAZS_MAIL",
      credentials: balazs,
      user:
        environment.INVOICE_COLLECTION_BALAZS_USER?.trim() ||
        "balazs@acropora.hu",
    });
  const drive = credentials(environment, "GOOGLE_DRIVE");
  const folderId = driveFolderId(environment.MISSING_INVOICES_DRIVE_FOLDER_URL);
  if (drive && folderId)
    sources.push({ source: "DRIVE", credentials: drive, folderId });
  return sources;
}

function bounded(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = Number(raw?.trim());
  return raw?.trim() &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

/**
 * MIÉRT 150 ÉS NEM 45: a párosító a terhelés előtt 4 hónapig keres számlát
 * (`inWindow`), a 45 napos begyűjtés ennél rövidebb. Mérve 2026-10-01, éles:
 * a Fluidra KS26/08732 július 24-én kelt, szeptember 25-én fizettük, a levele
 * a 45 napos ablakon kívül esett, és a gyűjtő sosem látta. A már látott levelet
 * a `seen` nem tölti le újra, tehát a hosszabb ablak csak az első futást drágítja.
 */
export function invoiceCollectionDays(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  return bounded(environment.INVOICE_COLLECTION_DAYS, 7, 400, 150);
}

export function invoiceCollectionIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  return bounded(environment.INVOICE_COLLECTION_INTERVAL_MINUTES, 5, 1440, 60);
}

/**
 * A levél-keresés: PDF-melléklet az utolsó napokból, feladó-szűrés NÉLKÜL. A
 * szűrés a tartalmon megy (számlának látszik-e), nem a feladón: egy új
 * szállító így nem kíván beállítást.
 */
export function invoiceCollectionMailQuery(days: number): string {
  return `has:attachment filename:pdf newer_than:${days}d`;
}

/** Az egy mondat, amit a napló és az állapot is mond. */
export function describeInvoiceCollectionState(
  switchState: SupplierInvoiceMailSwitch,
  sources: readonly InvoiceCollectionSourceConfig[],
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!switchState.on) {
    const why = {
      NOT_SET: "INVOICE_COLLECTION_ENABLED is not set",
      OFF: "INVOICE_COLLECTION_ENABLED is false",
      UNRECOGNISED:
        "INVOICE_COLLECTION_ENABLED is set to something that is neither true nor false",
    }[switchState.reason];
    return `Invoice collection disabled (${why})`;
  }
  const missing = INVOICE_COLLECTION_SOURCES.filter(
    (source) => !sources.some((s) => s.source === source),
  ).map(
    (source) =>
      ({
        INFO_MAIL:
          "info@ (no GMAIL_SUPPLIER_INVOICE_*, GMAIL_GLS_*, GMAIL_FOXPOST_* key)",
        BALAZS_MAIL: "balazs@ (GMAIL_BALAZS_* empty)",
        DRIVE: driveFolderId(environment.MISSING_INVOICES_DRIVE_FOLDER_URL)
          ? "Drive (GOOGLE_DRIVE_* empty)"
          : "Drive (MISSING_INVOICES_DRIVE_FOLDER_URL has no folder id)",
      })[source],
  );
  if (!sources.length)
    return `Invoice collection disabled (switched on, but no source has a key: ${missing.join("; ")})`;
  return `Invoice collection enabled (${invoiceCollectionIntervalMinutes(environment)} min, sources: ${sources.map((s) => s.source).join(", ")}${missing.length ? `; skipped: ${missing.join("; ")}` : ""})`;
}

const BUDAPEST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
});

/**
 * Az UNMATCHED újraolvasás döntése: nincs még teljes futás, az utolsó teljes
 * futás egy korábbi budapesti napon indult, vagy azóta új terhelés jött.
 */
export function unmatchedRetryDue(
  lastCompleteStartedAt: Date | null,
  newDebitsSince: number,
  now: Date,
): boolean {
  if (!lastCompleteStartedAt) return true;
  if (BUDAPEST_DAY.format(lastCompleteStartedAt) !== BUDAPEST_DAY.format(now))
    return true;
  return newDebitsSince > 0;
}
