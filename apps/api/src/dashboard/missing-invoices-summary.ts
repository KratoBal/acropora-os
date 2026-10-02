import type {
  DashboardMissingInvoicesWidgetData,
  MissingInvoiceMonthsResponse,
} from "@acropora/types";

/** Owner decision (PR #1379, 2026-10-02): a 5-minute in-process cache is fine. */
export const MISSING_INVOICES_CACHE_MS = 5 * 60 * 1000;
const MONTHS_SHOWN = 2;

/**
 * THE MISSING-INVOICE CHECK, CACHED FOR THE DASHBOARD.
 *
 * `MissingInvoicesService.months()` reruns the whole matching over every bank
 * debit, so a dashboard that called it on every page load would cost the
 * same as opening the missing-invoices page each time. The result is kept
 * for 5 minutes, in this process only. Concurrent loads share ONE run, and a
 * failure is never cached: the next load tries again.
 */
export class MissingInvoicesSummaryCache {
  private cached: { at: number; value: MissingInvoiceMonthsResponse } | null =
    null;
  private inFlight: Promise<MissingInvoiceMonthsResponse> | null = null;

  constructor(
    private readonly load: () => Promise<MissingInvoiceMonthsResponse>,
    private readonly clock: () => number = Date.now,
  ) {}

  async summary(): Promise<DashboardMissingInvoicesWidgetData> {
    return toWidgetData(await this.months());
  }

  private async months(): Promise<MissingInvoiceMonthsResponse> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < MISSING_INVOICES_CACHE_MS)
      return this.cached.value;
    if (!this.inFlight)
      this.inFlight = this.load()
        .then((value) => {
          this.cached = { at: this.clock(), value };
          return value;
        })
        .finally(() => {
          this.inFlight = null;
        });
    return this.inFlight;
  }
}

/** The two newest months; "missing" is what the missing-invoices page lists as missing. */
export function toWidgetData(
  response: MissingInvoiceMonthsResponse,
): DashboardMissingInvoicesWidgetData {
  return {
    months: response.months.slice(0, MONTHS_SHOWN).map((month) => ({
      month: month.month,
      missing: month.originalMissing + month.notMatched + month.noInvoice,
      originalMissing: month.originalMissing,
      notMatched: month.notMatched,
      noInvoice: month.noInvoice,
      missingAmountHuf: month.missingAmountHuf,
      status: month.status,
    })),
  };
}
