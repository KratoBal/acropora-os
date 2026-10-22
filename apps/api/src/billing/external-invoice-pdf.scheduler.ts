import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { budapestDayKey } from "../dashboard/budapest-day.js";
import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPdfClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { msUntilNextRun } from "./paid-marks/paid-marks-auto.scheduler.js";
import {
  createDocumentStore,
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  fillExternalInvoicePdfs,
  prismaExternalPdfStore,
  type ExternalPdfCandidate,
  type ExternalPdfStore,
} from "./external-invoice-pdf-fill.js";

/**
 * THE DAILY PDF CATCH-UP OF THE INVOICES ISSUED ON THE SZÁMLÁZZ.HU SITE
 * (card 10964cc7 follow-up; acrobot 35286 on Balázs's 2026-10-13 rule: a
 * limited automatism instead of a recurring manual step).
 *
 * It is the same fill as `external-invoice-pdf:fill --apply` (one Agent API
 * `xmlszamlapdf` request per number, read only on the Számlázz.hu side), run
 * once a day at 06:00 server time, after the 05:00 eBIZ sync and before the
 * 07:00 paid marks and the 07:30 invoice check. The bindings:
 *
 *   - the last TWO calendar months (Budapest, by issue date), only the rows
 *     WITHOUT a stored PDF: a row that has one is not even a candidate, and
 *     the store's write is conditional on "still no PDF", so a PDF stored in
 *     the meantime (the cmfx letter fill) is never overwritten;
 *   - ON by default, off with `EXTERNAL_INVOICE_PDF_SCHEDULE=0` (or false,
 *     off, no);
 *   - one summary log line per run (examined, stored, failed), and a failure
 *     of any kind stays inside the run: it is logged, the next day's timer is
 *     set, and no other scheduler is touched;
 *   - without `DOCUMENT_STORE_ROOT` nothing runs: the in-memory store would
 *     lose the bytes at the next start while the row kept the key (the CLI
 *     refuses the same way).
 *
 * A number Számlázz.hu does not know (error 7: the cmfx webshop invoices) is
 * marked once and then left out, as in the CLI.
 */
export const EXTERNAL_INVOICE_PDF_HOUR = 6;

/** The environment; a spec gives its own through this token. */
export const EXTERNAL_INVOICE_PDF_ENV = Symbol("EXTERNAL_INVOICE_PDF_ENV");

const OFF_VALUES = new Set(["0", "false", "off", "no"]);

/** Default ON: only an explicit off value switches the run off. */
export function externalInvoicePdfScheduleOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.EXTERNAL_INVOICE_PDF_SCHEDULE?.trim().toLowerCase();
  return value === undefined || !OFF_VALUES.has(value);
}

/** This month and the one before it, as YYYY-MM, by the Budapest calendar. */
export function lastTwoMonths(now: Date): [string, string] {
  const [year, month] = budapestDayKey(now).split("-").map(Number) as [
    number,
    number,
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  const previous = month === 1 ? [year - 1, 12] : [year, month - 1];
  return [`${year}-${pad(month)}`, `${previous[0]}-${pad(previous[1]!)}`];
}

export interface ExternalPdfRunSummary {
  /** `null`: the run happened; a code: it did not start, and why. */
  skipped: string | null;
  months: [string, string];
  examined: number;
  stored: number;
  failed: number;
}

export interface ExternalPdfRunDeps {
  now: Date;
  store: ExternalPdfStore;
  credential: () => Promise<{ agentKey: string }>;
  client: SzamlazzAgentPdfClient;
  documents: Pick<DocumentStore, "put"> | null;
}

/** The run itself. The known failures come back as `skipped`; the scheduler catches the rest. */
export async function runExternalInvoicePdfFill(
  deps: ExternalPdfRunDeps,
): Promise<ExternalPdfRunSummary> {
  const months = lastTwoMonths(deps.now);
  const empty = { months, examined: 0, stored: 0, failed: 0 };
  if (!deps.documents) return { ...empty, skipped: "DOCUMENT_STORE_NOT_SET" };
  let candidates: ExternalPdfCandidate[];
  try {
    candidates = [
      ...(await deps.store.candidates(months[1])),
      ...(await deps.store.candidates(months[0])),
    ];
  } catch {
    return { ...empty, skipped: "CANDIDATES_FAILED" };
  }
  if (candidates.length === 0) return { ...empty, skipped: null };
  let agentKey: string;
  try {
    agentKey = (await deps.credential()).agentKey;
  } catch {
    return {
      ...empty,
      examined: candidates.length,
      skipped: "SZAMLAZZ_CREDENTIAL_UNAVAILABLE",
    };
  }
  // a store or Agent API error stops only that invoice (the fill marks it)
  const outcomes = await fillExternalInvoicePdfs({
    candidates,
    agentKey,
    client: deps.client,
    documents: deps.documents,
    store: deps.store,
  });
  const failed = outcomes.filter((o) => o.kind === "FAILED").length;
  return {
    skipped: null,
    months,
    examined: candidates.length,
    stored: outcomes.length - failed,
    failed,
  };
}

/** The one log line of a run. */
export function externalPdfRunLine(summary: ExternalPdfRunSummary): string {
  const scope = `${summary.months[1]}, ${summary.months[0]}`;
  if (summary.skipped)
    return `Külső számla PDF-pótlás (${scope}): nem futott le (${summary.skipped}), vizsgált ${summary.examined}`;
  return `Külső számla PDF-pótlás (${scope}): vizsgált ${summary.examined}, pótolt ${summary.stored}, hiba ${summary.failed}`;
}

@Injectable()
export class ExternalInvoicePdfScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExternalInvoicePdfScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly credentials: SzamlazzCredentialProvider,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
    @Optional()
    @Inject(EXTERNAL_INVOICE_PDF_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  onModuleInit(): void {
    if (!externalInvoicePdfScheduleOn(this.env)) {
      this.logger.log(
        "Külső számla PDF-pótlás: KI (EXTERNAL_INVOICE_PDF_SCHEDULE).",
      );
      return;
    }
    this.logger.log(
      `Külső számla PDF-pótlás: naponta ${EXTERNAL_INVOICE_PDF_HOUR}:00-kor, az utolsó két hónap PDF nélküli sorai.`,
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
    deps: Partial<ExternalPdfRunDeps> = {},
  ): Promise<ExternalPdfRunSummary> {
    const months = lastTwoMonths(now);
    let summary: ExternalPdfRunSummary;
    try {
      summary = await runExternalInvoicePdfFill({
        now,
        store: prismaExternalPdfStore,
        credential: () => this.credentials.resolve(),
        client: new HttpSzamlazzAgentClient(),
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
        failed: 0,
      };
    }
    const line = externalPdfRunLine(summary);
    if (summary.skipped || summary.failed > 0) this.logger.error(line);
    else this.logger.log(line);
    return summary;
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
      msUntilNextRun(new Date(), EXTERNAL_INVOICE_PDF_HOUR),
    );
    this.timer.unref();
  }
}
