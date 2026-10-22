import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { GoogleReadonlyClient } from "../integrations/google/google-readonly.client.js";
import { supplierInvoiceMailCredentials } from "../purchasing/expected-arrivals/supplier-invoice-mail.config.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  createDocumentStore,
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import {
  fillExternalPdfsFromMail,
  mailPdfCandidates,
  type MailPdf,
  type MailPdfCandidate,
} from "./external-invoice-mail-pdf.js";
import {
  readCmfxMail,
  REQUEST_GAP_MS,
} from "./external-invoice-mail-pdf.cli.js";
import {
  lastTwoMonths,
  scheduleSwitchOn,
} from "./external-invoice-pdf.scheduler.js";
import { prismaExternalPdfStore } from "./external-invoice-pdf-fill.js";

/**
 * THE DAILY PDF CATCH-UP OF THE CMFX WEBSHOP INVOICES FROM THEIR LETTERS (card
 * 10964cc7 follow-up; acrobot 35299 on Balázs's 2026-10-13 rule: a limited
 * automatism instead of a recurring manual step).
 *
 * The same fill as `external-invoice-mail-pdf:fill --apply`: the webshop's
 * invoices are issued in cmfx, the Számlázz.hu Agent API does not know them,
 * and cmfx sends a copy of every e-invoice to info@ (`ertesito@cmfx.hu`). Once
 * a day at 06:10 server time, ten minutes after the Számlázz.hu catch-up, for
 * the last TWO calendar months (Budapest, by issue date). The bindings:
 *
 *   - only the rows WITHOUT a stored PDF are candidates, and a month with no
 *     candidate does not read the mailbox at all; the store's write is
 *     conditional on "still no PDF", so a PDF stored in the meantime is never
 *     overwritten;
 *   - ON by default, off with `EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE=0` (or
 *     false, off, no): its OWN switch, apart from the Számlázz.hu catch-up's;
 *   - it reads the letters the fill already reads, nothing else: the same
 *     read-only info@ key, the query `from:ertesito@cmfx.hu has:attachment`
 *     and the sender-header check, and a PDF counts only from a letter whose
 *     DKIM and DMARC the Gmail verdict vouches for. It changes nothing in
 *     Gmail;
 *   - the log carries counts and error codes only: never a letter's address,
 *     subject, text or attachment, and no invoice number;
 *   - one summary log line per run; a failure of the key, the mailbox, the
 *     store or one invoice stays inside the run (a month's failure does not
 *     stop the other month), and no other scheduler is touched;
 *   - without `DOCUMENT_STORE_ROOT`, or without the mailbox key, nothing runs.
 *
 * A row whose letter never came ("not always sent by email", Balázs) stays a
 * candidate and shows as `NO_MAIL`: normal, counted, not an error. A letter
 * that fails the number, our-tax-number or payable-total check is retried
 * every day and counts as a failure every day: that is the point of the line.
 */
export const EXTERNAL_INVOICE_MAIL_PDF_HOUR = 6;
export const EXTERNAL_INVOICE_MAIL_PDF_MINUTE = 10;

/** The environment; a spec gives its own through this token. */
export const EXTERNAL_INVOICE_MAIL_PDF_ENV = Symbol(
  "EXTERNAL_INVOICE_MAIL_PDF_ENV",
);

/** Default ON: `EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE=0` (false, off, no) switches it off. */
export function externalInvoiceMailPdfScheduleOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return scheduleSwitchOn(env.EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE);
}

/** Milliseconds from `now` to the next `hour:minute` local time (today or tomorrow). */
export function msUntilNextAt(now: Date, hour: number, minute: number): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface ExternalMailPdfRunSummary {
  /** `null`: the run happened; a code: it did not start, and why. */
  skipped: string | null;
  months: [string, string];
  examined: number;
  stored: number;
  /** The PDF checked out, but the row had one by then: not written, not counted as stored. */
  alreadyHad: number;
  /** A candidate whose letter did not come: normal for a cmfx invoice that was not mailed. */
  noMail: number;
  /** Failed checks and store errors, plus one per month that could not be run. */
  failed: number;
  /** Error codes of the months that could not be run (no letter content). */
  errorCodes: string[];
}

export interface ExternalMailPdfRunDeps {
  now: Date;
  candidates: (month: string) => Promise<MailPdfCandidate[]>;
  mail: (month: string) => Promise<MailPdf[]>;
  textOf: (bytes: Uint8Array) => Promise<string[]>;
  documents: Pick<DocumentStore, "put"> | null;
  store: {
    setPdf(id: string, key: string, reason: null): Promise<boolean | void>;
  };
}

const CHECK_FAILURES = new Set([
  "NOT_PDF",
  "NUMBER_NOT_IN_PDF",
  "NOT_OUR_INVOICE",
  "AMOUNT_MISMATCH",
  "STORE_FAILED",
  "NOT_AUTHENTICATED",
]);

function errorCode(error: unknown): string {
  const name =
    (error as { code?: unknown })?.code ??
    (error instanceof Error ? error.name : undefined);
  return typeof name === "string" && /^[A-Z0-9_:.-]+$/.test(name)
    ? name
    : "MAIL_PDF_FILL_FAILED";
}

/** The run itself. The known failures come back in the summary; the scheduler catches the rest. */
export async function runExternalInvoiceMailPdfFill(
  deps: ExternalMailPdfRunDeps,
): Promise<ExternalMailPdfRunSummary> {
  const months = lastTwoMonths(deps.now);
  const summary: ExternalMailPdfRunSummary = {
    skipped: null,
    months,
    examined: 0,
    stored: 0,
    alreadyHad: 0,
    noMail: 0,
    failed: 0,
    errorCodes: [],
  };
  if (!deps.documents) return { ...summary, skipped: "DOCUMENT_STORE_NOT_SET" };
  for (const month of [months[1], months[0]]) {
    try {
      const candidates = await deps.candidates(month);
      summary.examined += candidates.length;
      // nothing to fill: the mailbox is not read
      if (candidates.length === 0) continue;
      const report = await fillExternalPdfsFromMail({
        candidates,
        pdfs: await deps.mail(month),
        apply: true,
        textOf: deps.textOf,
        documents: deps.documents,
        store: deps.store,
      });
      for (const outcome of report.outcomes) {
        if (outcome.kind === "STORED") summary.stored += 1;
        else if (outcome.kind === "ALREADY_HAD") summary.alreadyHad += 1;
        else if (outcome.kind === "NO_MAIL") summary.noMail += 1;
        else if (CHECK_FAILURES.has(outcome.kind)) summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.errorCodes.push(errorCode(error));
    }
  }
  return summary;
}

/** The one log line of a run: counts and codes, no content. */
export function externalMailPdfRunLine(
  summary: ExternalMailPdfRunSummary,
): string {
  const scope = `${summary.months[1]}, ${summary.months[0]}`;
  if (summary.skipped)
    return `Külső számla PDF-pótlás cmfx-levélből (${scope}): nem futott le (${summary.skipped})`;
  const codes = summary.errorCodes.length
    ? ` [${summary.errorCodes.join(", ")}]`
    : "";
  return `Külső számla PDF-pótlás cmfx-levélből (${scope}): vizsgált ${summary.examined}, pótolt ${summary.stored}, közben már volt ${summary.alreadyHad}, levél nélkül ${summary.noMail}, hiba ${summary.failed}${codes}`;
}

@Injectable()
export class ExternalInvoiceMailPdfScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExternalInvoiceMailPdfScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
    @Optional()
    @Inject(EXTERNAL_INVOICE_MAIL_PDF_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  onModuleInit(): void {
    if (!externalInvoiceMailPdfScheduleOn(this.env)) {
      this.logger.log(
        "Külső számla PDF-pótlás cmfx-levélből: KI (EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE).",
      );
      return;
    }
    if (!supplierInvoiceMailCredentials(this.env)) {
      this.logger.log(
        "Külső számla PDF-pótlás cmfx-levélből: nincs levélkulcs (GMAIL_SUPPLIER_INVOICE_*), semmi nem ütemeződik.",
      );
      return;
    }
    this.logger.log(
      `Külső számla PDF-pótlás cmfx-levélből: naponta ${EXTERNAL_INVOICE_MAIL_PDF_HOUR}:${String(EXTERNAL_INVOICE_MAIL_PDF_MINUTE).padStart(2, "0")}-kor, az utolsó két hónap PDF nélküli sorai, csak olvasás a postafiókban.`,
    );
    this.schedule();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One run; never throws. The deps are for the spec. */
  async runOnce(
    now = new Date(),
    deps: Partial<ExternalMailPdfRunDeps> = {},
  ): Promise<ExternalMailPdfRunSummary> {
    const months = lastTwoMonths(now);
    let summary: ExternalMailPdfRunSummary;
    try {
      summary = await runExternalInvoiceMailPdfFill({
        now,
        candidates: mailPdfCandidates,
        mail: (month) => this.readMail(month),
        textOf: pdfTextLines,
        store: prismaExternalPdfStore,
        documents:
          "documents" in deps ? (deps.documents ?? null) : this.documents(),
        ...deps,
      });
    } catch {
      summary = {
        skipped: "RUN_FAILED",
        months,
        examined: 0,
        stored: 0,
        alreadyHad: 0,
        noMail: 0,
        failed: 0,
        errorCodes: [],
      };
    }
    const line = externalMailPdfRunLine(summary);
    if (summary.skipped || summary.failed > 0) this.logger.error(line);
    else this.logger.log(line);
    return summary;
  }

  /** The month's cmfx letters, read with the read-only info@ key; no key, no read. */
  private async readMail(month: string): Promise<MailPdf[]> {
    const credentials = supplierInvoiceMailCredentials(this.env);
    if (!credentials) throw Object.assign(new Error(), { code: "NO_MAIL_KEY" });
    const user =
      this.env.INVOICE_COLLECTION_INFO_USER?.trim() || "info@acropora.hu";
    const google = new GoogleReadonlyClient({
      credentials,
      requestGapMs: REQUEST_GAP_MS,
    });
    return readCmfxMail(google, user, month);
  }

  /** The store the run writes to; none unless the root is set (see above). */
  private documents(): DocumentStore | null {
    if (!documentStoreEnabled(this.env)) return null;
    return this.documentStore ?? createDocumentStore(this.env);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => {
        void this.runOnce().finally(() => this.schedule());
      },
      msUntilNextAt(
        new Date(),
        EXTERNAL_INVOICE_MAIL_PDF_HOUR,
        EXTERNAL_INVOICE_MAIL_PDF_MINUTE,
      ),
    );
    this.timer.unref();
  }
}
