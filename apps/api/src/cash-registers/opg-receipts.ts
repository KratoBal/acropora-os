import { Prisma } from "@acropora/database";
import {
  element,
  elements,
  text,
  parseOpgXml,
  unsignedInteger,
  OpgError,
  OPG_LOG_NS,
  type OpgNode,
} from "./opg-xml.js";
export type PaymentCategory = "CASH" | "CARD" | "OTHER" | "UNKNOWN";
export interface Payment {
  category: PaymentCategory;
  amount: string;
}
export interface ReceiptLine {
  position: number;
  name: string;
  unitPrice: string;
  quantity: string;
  sum: string;
  vatCode: string;
}
export interface Receipt {
  receiptNumber: string;
  issuedAt: Date;
  businessDay: Date;
  total: string;
  paymentMeans: string;
  payments: Payment[];
  cancelled: boolean;
  kind: "SALE" | "STORNO" | "RETURN";
  navCheckCode: string | null;
  lines: ReceiptLine[];
}
export function decimal(value: string | undefined, scale = 4): string {
  const v = value?.trim().replace(",", ".");
  if (
    !v ||
    !new RegExp(`^[+-]?\\d{1,${20 - scale}}(?:\\.\\d{1,${scale}})?$`).test(v)
  )
    throw new OpgError("OPG_AMOUNT_INVALID");
  return new Prisma.Decimal(v).toString();
}
export function businessDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function netAmount(
  kind: Receipt["kind"],
  value: string,
): Prisma.Decimal {
  const amount = new Prisma.Decimal(value);
  return kind === "SALE" ? amount : amount.abs().negated();
}
const required = (n: OpgNode, key: string) => {
  const v = text(n, key);
  if (!v) throw new OpgError("OPG_RECEIPT_INVALID");
  return v;
};
export function parseReceipts(
  xml: Buffer,
  apNumber: string,
  fileNumber: number,
): Receipt[] {
  const root = parseOpgXml(
    new TextDecoder("utf-8", { fatal: true }).decode(xml),
  );
  if (root.name !== "ROWS" || root.uri !== OPG_LOG_NS)
    throw new OpgError("OPG_LOG_INVALID");
  const opening = element(root, "LON");
  if (
    !opening ||
    text(opening, "APN") !== apNumber ||
    unsignedInteger(text(opening, "LFN")) !== fileNumber
  )
    throw new OpgError("OPG_LOG_IDENTITY_MISMATCH");
  const receipts: Receipt[] = [];
  for (const n of root.children) {
    if (n.uri !== OPG_LOG_NS || !["NYN", "SZN", "VBN"].includes(n.name))
      continue;
    const kind =
      n.name === "NYN" ? "SALE" : n.name === "SZN" ? "STORNO" : "RETURN";
    const number = required(
      n,
      kind === "SALE" ? "NSZ" : kind === "STORNO" ? "SBS" : "VBS",
    );
    const timestamp = required(n, "DTS");
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        timestamp,
      )
    )
      throw new OpgError("OPG_TIMESTAMP_INVALID");
    const issuedAt = new Date(timestamp);
    if (!Number.isFinite(issuedAt.getTime()))
      throw new OpgError("OPG_TIMESTAMP_INVALID");
    const total = decimal(text(n, "SUM"));
    const flag = required(n, "CNC");
    if (!["0", "1"].includes(flag)) throw new OpgError("OPG_RECEIPT_INVALID");
    const lines: ReceiptLine[] = [];
    for (const block of elements(n, "ITL")) {
      let group: OpgNode[] = [];
      const flush = () => {
        if (!group.length) return;
        const node: OpgNode = { ...block, children: group };
        lines.push({
          position: lines.length,
          name: required(node, "NA"),
          unitPrice: decimal(text(node, "UN")),
          quantity: decimal(text(node, "QY"), 6),
          sum: decimal(text(node, "SU")),
          vatCode: required(node, "VC"),
        });
        group = [];
      };
      for (const child of block.children) {
        if (child.name === "NA") flush();
        group.push(child);
      }
      flush();
    }
    const sums = new Map<PaymentCategory, Prisma.Decimal>();
    const add = (category: PaymentCategory, v: string | undefined) => {
      if (v === undefined) return;
      const amount = netAmount(kind, decimal(v));
      sums.set(
        category,
        (sums.get(category) ?? new Prisma.Decimal(0)).add(amount),
      );
    };
    for (const drc of elements(n, "DRC")) {
      add("CASH", text(drc, "FE1"));
      add("CARD", text(drc, "FE2"));
      add("OTHER", text(drc, "FEE"));
      for (const foreign of elements(drc, "FEV"))
        add("CASH", text(foreign, "CFT"));
      for (const other of elements(drc, "FE3")) {
        for (const item of elements(other, "FES")) add("OTHER", item.text);
      }
    }
    // Preserve an explicit unallocated difference (including cash rounding), never infer a payment from printed card details.
    const allocated = [...sums.values()].reduce(
        (s, v) => s.add(v),
        new Prisma.Decimal(0),
      ),
      difference = netAmount(kind, total).sub(allocated);
    if (!difference.isZero()) sums.set("UNKNOWN", difference);
    const payments = [...sums]
      .filter(([, v]) => !v.isZero())
      .map(([category, amount]) => ({ category, amount: amount.toString() }));
    receipts.push({
      receiptNumber: number,
      issuedAt,
      businessDay: new Date(`${businessDay(issuedAt)}T00:00:00Z`),
      total,
      paymentMeans: payments.map((p) => p.category).join("+") || "UNKNOWN",
      payments,
      cancelled: flag === "1",
      kind,
      navCheckCode: text(n, "NAV") ?? null,
      lines,
    });
  }
  if (new Set(receipts.map((r) => r.receiptNumber)).size !== receipts.length)
    throw new OpgError("OPG_DUPLICATE_RECEIPT");
  return receipts;
}
