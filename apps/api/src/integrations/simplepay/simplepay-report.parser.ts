/**
 * THE SIMPLEPAY WEEKLY REPORT, READ (#GLS elszámolás thread, Balázs,
 * 2026-09-30 12:07 UTC: "kellene egy simple pay kimutatás is mint a
 * foxpostnál és a gls-nél").
 *
 * SimplePay sends "SimplePay - Forgalmi kimutatás" every Wednesday from
 * noreply@simplepay.hu, with the week's card payments as `report_YYYYMMDD.csv`
 * and a summary in the mail body. The CSV:
 *
 *   - semicolon separated, UTF-8 with a BOM, Hungarian decimal comma
 *     ("38477,00");
 *   - one row per transaction; the merchant transaction ID ("111737061T628506")
 *     carries the UNAS order: the part AFTER the "T" is the end of the UNAS
 *     order key ("47679-628506"). Measured on 4 of 4 matchable rows,
 *     2026-09-30 (acrobot 25056).
 *
 * Columns are found by their LABEL, never by position. The buyer's name and
 * e-mail columns ("Vásárló", "E-mail cím") are never read: the settlement
 * does not need them, and what is not read cannot leak further.
 */

export class SimplePayReportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SimplePayReportError";
  }
}

export interface SimplePayTransaction {
  /** The CSV data row (1-based, header excluded), stable for one file. */
  rowNumber: number;
  /** "COMPLETED" in every row measured; kept verbatim. */
  status: string;
  paymentType: string | null;
  simplePayTransactionId: string;
  merchantTransactionId: string;
  /** The UNAS order key's number part ("628506"), or null if the ID has no "T". */
  orderKeySuffix: string | null;
  /** Local Budapest time as SimplePay writes it: "YYYY-MM-DD HH:MM:SS". */
  transactionAt: string;
  completedAt: string | null;
  currency: string;
  amount: number;
  /** "Tranzakciós jutalék": the whole fee, the three below added up. */
  commission: number;
  interchangeFee: number | null;
  schemeFee: number | null;
  merchantFee: number | null;
  /** "Jutalékkal csökkentett összeg": what SimplePay transfers. */
  netAmount: number;
}

export interface SimplePayReport {
  transactions: SimplePayTransaction[];
  currency: string;
  amountTotal: number;
  commissionTotal: number;
  netTotal: number;
  /**
   * Rows that do not add up (amount - commission != net, or the three fees
   * != commission). The row is still returned: a report that does not add
   * up goes to a person, it is not dropped.
   */
  warnings: string[];
}

const LABELS = {
  status: "Tranzakció státusz",
  paymentType: "Fizetés típusa",
  simplePayId: "SimplePay tranzakció ID",
  merchantId: "Kereskedői tranzakció ID",
  transactionAt: "Tranzakció dátuma",
  completedAt: "Teljesítés dátuma",
  currency: "Devizanem",
  commission: "Tranzakciós jutalék",
  // the three fee columns carry long, compound labels; matched by prefix
  interchangeFee: "Bankközi díj",
  schemeFee: "Kártyatársasági díj",
  merchantFee: "Kereskedői díj",
  amount: "Tranzakció összege",
  netAmount: "Jutalékkal csökkentett összeg",
} as const;

const REQUIRED: readonly (keyof typeof LABELS)[] = [
  "status",
  "simplePayId",
  "merchantId",
  "transactionAt",
  "currency",
  "commission",
  "amount",
  "netAmount",
];

/** One CSV record per row; quoted fields may hold the separator or a quote. */
export function parseCsv(text: string, separator = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function money(raw: string | undefined, code: string): number {
  const value = Number(
    (raw ?? "").replace(/[\s\u00a0]/g, "").replace(",", "."),
  );
  if (!raw?.trim() || !Number.isFinite(value))
    throw new SimplePayReportError(code);
  return Math.round(value * 100) / 100;
}

function optionalMoney(raw: string | undefined): number | null {
  return raw === undefined || raw.trim() === ""
    ? null
    : money(raw, "SIMPLEPAY_AMOUNT_INVALID");
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function dateTime(raw: string | undefined, required: boolean): string | null {
  const value = raw?.trim() ?? "";
  if (!value && !required) return null;
  if (!DATE_TIME.test(value))
    throw new SimplePayReportError("SIMPLEPAY_DATE_INVALID");
  return value;
}

export function readSimplePayReport(content: Buffer | string): SimplePayReport {
  const text = (
    typeof content === "string" ? content : content.toString("utf8")
  ).replace(/^\uFEFF/, "");
  const [header, ...records] = parseCsv(text);
  if (!header) throw new SimplePayReportError("SIMPLEPAY_EMPTY");

  const labels = header.map((cell) => cell.trim());
  const column = Object.fromEntries(
    Object.entries(LABELS).map(([key, label]) => [
      key,
      labels.findIndex((cell) => cell === label || cell.startsWith(label)),
    ]),
  ) as Record<keyof typeof LABELS, number>;
  if (REQUIRED.some((key) => column[key] < 0))
    throw new SimplePayReportError("SIMPLEPAY_COLUMNS_MISSING");

  const cell = (record: string[], key: keyof typeof LABELS) =>
    column[key] < 0 ? undefined : record[column[key]];

  const warnings: string[] = [];
  const transactions = records.map((record, index): SimplePayTransaction => {
    const merchantTransactionId = cell(record, "merchantId")?.trim() ?? "";
    const simplePayTransactionId = cell(record, "simplePayId")?.trim() ?? "";
    if (!merchantTransactionId || !simplePayTransactionId)
      throw new SimplePayReportError("SIMPLEPAY_ID_MISSING");
    const suffix = /^\d+T(\d+)$/.exec(merchantTransactionId)?.[1] ?? null;
    const row: SimplePayTransaction = {
      rowNumber: index + 1,
      status: cell(record, "status")?.trim() ?? "",
      paymentType: cell(record, "paymentType")?.trim() || null,
      simplePayTransactionId,
      merchantTransactionId,
      orderKeySuffix: suffix,
      transactionAt: dateTime(cell(record, "transactionAt"), true)!,
      completedAt: dateTime(cell(record, "completedAt"), false),
      currency: cell(record, "currency")?.trim() || "HUF",
      amount: money(cell(record, "amount"), "SIMPLEPAY_AMOUNT_INVALID"),
      commission: money(cell(record, "commission"), "SIMPLEPAY_AMOUNT_INVALID"),
      interchangeFee: optionalMoney(cell(record, "interchangeFee")),
      schemeFee: optionalMoney(cell(record, "schemeFee")),
      merchantFee: optionalMoney(cell(record, "merchantFee")),
      netAmount: money(cell(record, "netAmount"), "SIMPLEPAY_AMOUNT_INVALID"),
    };
    if (cents(row.amount - row.commission) !== row.netAmount)
      warnings.push(
        `${row.rowNumber}. sor (${merchantTransactionId}): az összeg és a jutalék különbsége nem egyezik az utalt összeggel.`,
      );
    const fees = [row.interchangeFee, row.schemeFee, row.merchantFee];
    if (
      fees.every((fee) => fee !== null) &&
      cents(fees.reduce((sum: number, fee) => sum + fee!, 0)) !== row.commission
    )
      warnings.push(
        `${row.rowNumber}. sor (${merchantTransactionId}): a három díj összege nem egyezik a jutalékkal.`,
      );
    if (!suffix)
      warnings.push(
        `${row.rowNumber}. sor (${merchantTransactionId}): a kereskedői azonosítóból nem olvasható ki a rendelés.`,
      );
    return row;
  });

  const currencies = new Set(transactions.map((row) => row.currency));
  if (currencies.size > 1)
    throw new SimplePayReportError("SIMPLEPAY_MIXED_CURRENCY");

  return {
    transactions,
    currency: transactions[0]?.currency ?? "HUF",
    amountTotal: cents(sum(transactions, "amount")),
    commissionTotal: cents(sum(transactions, "commission")),
    netTotal: cents(sum(transactions, "netAmount")),
    warnings,
  };
}

/**
 * The summary in the mail body. It is SimplePay's own count and total, so
 * the service can check the CSV against it: a CSV that disagrees with its
 * own mail is not booked silently.
 */
export interface SimplePayMailSummary {
  /** YYYY-MM-DD */
  periodStart: string;
  periodEnd: string;
  transactionCount: number | null;
  amountTotal: number | null;
  commissionTotal: number | null;
}

export function readSimplePayMailSummary(
  body: string,
): SimplePayMailSummary | null {
  const flat = body.replace(/\s+/g, " ");
  const period =
    /(\d{4})\.(\d{2})\.(\d{2})\s*-\s*(\d{4})\.(\d{2})\.(\d{2})\s+forgalmi időszak/.exec(
      flat,
    );
  if (!period) return null;
  const number = (label: string) => {
    const found = new RegExp(
      `${label}:\\s*(\\d{1,3}(?:[ \\u00a0.]\\d{3})*(?:,\\d+)?)(?!\\d)`,
    ).exec(flat);
    if (!found) return null;
    const value = Number(
      found[1]!.replace(/[\s\u00a0.]/g, "").replace(",", "."),
    );
    return Number.isFinite(value) ? value : null;
  };
  return {
    periodStart: `${period[1]}-${period[2]}-${period[3]}`,
    periodEnd: `${period[4]}-${period[5]}-${period[6]}`,
    transactionCount: number("Tranzakciók száma"),
    amountTotal: number("Tranzakciók végösszege"),
    commissionTotal: number("Tranzakciós jutalék"),
  };
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(
  rows: readonly SimplePayTransaction[],
  key: "amount" | "commission" | "netAmount",
): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
