import { Prisma } from "@acropora/database";
import {
  hasPermission,
  parseQuoteRichText,
  PERMISSIONS,
  type AuthenticatedUser,
  type QuoteCustomerDto,
  type QuoteCustomerVersion,
  type QuoteDetailDto,
  type QuoteListItemDto,
  type QuoteInternalVersion,
  type QuoteInternalDto,
  type QuoteInternalCostsDto,
  type QuoteBomLineDto,
  type QuoteRichText,
} from "@acropora/types";
import type { QuoteListRow, QuoteRow } from "./quotes.repository.js";
export function quoteListItemDto(
  row: QuoteListRow,
  netTotals: ReadonlyMap<string, string> = new Map(),
): QuoteListItemDto {
  const version = row.versions[0];
  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    title: row.title,
    status: row.status,
    customerId: row.customerId,
    ownerUserId: row.ownerUserId,
    customerName: row.customer?.displayName ?? null,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestVersion: version
      ? {
          id: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          validUntil: version.validUntil.toISOString().slice(0, 10),
          currency: version.currency,
          priceDisplay: version.priceDisplay as NonNullable<
            QuoteListItemDto["latestVersion"]
          >["priceDisplay"],
          publishedAt: version.publishedAt?.toISOString() ?? null,
          netTotal: netTotals.get(version.id) ?? "0.0000",
        }
      : null,
  };
}
export type { QuoteRow } from "./quotes.repository.js";
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
/** Read-side allowlist: no arbitrary JSON is reflected into the customer or cost-free DTO.
 * The node list is the shared one (`packages/types` quote-text-schema, P1 decision 5),
 * the same the editor and the write validator use. */
export const quoteText = (value: unknown): QuoteRichText | null =>
  parseQuoteRichText(value);
function blockContent(kind: string, value: unknown) {
  if (kind !== "IMAGE") return quoteText(value);
  const v = record(value);
  if (!v || typeof v.documentId !== "string") return null;
  return {
    documentId: v.documentId,
    ...(typeof v.caption === "string" ? { caption: v.caption } : {}),
    ...(typeof v.widthRatio === "number" && Number.isFinite(v.widthRatio)
      ? { widthRatio: v.widthRatio }
      : {}),
  };
}
function snapshot(value: unknown) {
  const v = record(value);
  if (!v) return null;
  const result: Record<string, string> = {};
  for (const key of [
    "name",
    "displayName",
    "country",
    "countryCode",
    "postalCode",
    "city",
    "street",
    "address",
    "taxNumber",
    "groupTaxNumber",
    "euTaxNumber",
  ])
    if (typeof v[key] === "string") result[key] = v[key] as string;
  return result;
}
/** Event payload is deliberately restricted for EVERY audience, including privileged callers. */
export function quoteEventPayload(
  value: unknown,
): Record<string, string | number | boolean> | null {
  const input = record(value);
  if (!input) return null;
  const output: Record<string, string | number | boolean> = {};
  for (const key of [
    "quoteNumber",
    "versionNumber",
    "previousVersionNumber",
    "requestId",
    "outcome",
    "fieldCount",
  ]) {
    const v = input[key];
    if (
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      output[key] = v;
  }
  return Object.keys(output).length ? output : null;
}
function versionDto(v: QuoteRow["versions"][number]): QuoteCustomerVersion {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    validUntil: v.validUntil.toISOString().slice(0, 10),
    currency: v.currency,
    priceDisplay: v.priceDisplay as QuoteCustomerVersion["priceDisplay"],
    customerSnapshot: snapshot(v.customerSnapshot),
    blocks: v.blocks.map((b) => ({
      id: b.id,
      position: b.position,
      kind: b.kind,
      title: b.title,
      content: blockContent(b.kind, b.content),
      keepWithNext: b.keepWithNext,
      startOnNewPage: b.startOnNewPage,
      items: b.items.map((i) => ({
        id: i.id,
        position: i.position,
        name: i.name,
        description: quoteText(i.description),
        quantity: i.quantity.toString(),
        unit: i.unit,
        unitNetPrice: i.unitNetPrice.toString(),
        vatRatePercent: i.vatRatePercent.toString(),
        isOptional: i.isOptional,
      })),
    })),
    milestones: v.milestones.map((m) => ({
      id: m.id,
      position: m.position,
      label: m.label,
      percent: m.percent.toString(),
    })),
  };
}
/**
 * THE BOM WITHOUT COSTS (P1; the plan's FÜGGETLEN VISSZAMÉRÉS P1 point): a
 * quote writer sees what the line is made of, never a cost, supplier or
 * internal note. Positive allowlist, like the other outputs.
 */
function bomLineDto(
  b: QuoteRow["versions"][number]["bomItems"][number],
): QuoteBomLineDto {
  return {
    id: b.id,
    quoteItemId: b.quoteItemId,
    position: b.position,
    kind: b.kind,
    variantId: b.variantId,
    customName: b.customName,
    variantLabel: variantLabel(b.variant),
    quantity: b.quantity.toString(),
    unit: b.unit,
    createdProductVariantId: b.createdProductVariantId,
  };
}
/** "Product · Variant (SKU)": the internal name of a linked variant (P1). */
function variantLabel(
  v: { sku: string; name: string | null; product: { name: string } } | null,
): string | null {
  if (!v) return null;
  return `${v.product.name}${v.name ? ` · ${v.name}` : ""} (${v.sku})`;
}
/** Offered and optional net totals of a version, exact (P1). */
function netTotals(v: QuoteRow["versions"][number]) {
  let offered = new Prisma.Decimal(0);
  let optional = new Prisma.Decimal(0);
  for (const b of v.blocks)
    for (const i of b.items) {
      const line = i.quantity.times(i.unitNetPrice);
      if (i.isOptional) optional = optional.plus(line);
      else offered = offered.plus(line);
    }
  return {
    netTotal: offered.toDecimalPlaces(4).toFixed(4),
    optionalNetTotal: optional.toDecimalPlaces(4).toFixed(4),
  };
}
function internalVersionDto(
  v: QuoteRow["versions"][number],
): QuoteInternalVersion {
  const dto = versionDto(v);
  return {
    ...dto,
    templateId: v.templateId,
    createdFromVersionId: v.createdFromVersionId,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    ...netTotals(v),
    bomItems: v.bomItems.map(bomLineDto),
    blocks: dto.blocks.map((b, index) => ({
      ...b,
      sourceSnippetId: v.blocks[index]!.sourceSnippetId,
      items: b.items.map((i, itemIndex) => ({
        ...i,
        source: v.blocks[index]!.items[itemIndex]!.source,
        variantId: v.blocks[index]!.items[itemIndex]!.variantId,
        variantLabel: variantLabel(
          v.blocks[index]!.items[itemIndex]!.variant ?? null,
        ),
      })),
    })),
  };
}
export function customerQuoteDto(row: QuoteRow): QuoteCustomerDto {
  return {
    audience: "customer",
    quoteNumber: row.quoteNumber,
    title: row.title,
    versions: row.versions.map(versionDto),
  };
}
export function internalQuoteDto(row: QuoteRow): QuoteInternalDto {
  return {
    audience: "internal",
    id: row.id,
    quoteNumber: row.quoteNumber,
    title: row.title,
    status: row.status,
    customerId: row.customerId,
    ownerUserId: row.ownerUserId,
    createdById: row.createdById,
    customerName: row.customer?.displayName ?? null,
    ownerName: row.owner?.displayName ?? null,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versions: row.versions.map(internalVersionDto),
    events: row.events.map((e) => ({
      id: e.id,
      versionId: e.versionId,
      kind: e.kind,
      actorUserId: e.actorUserId,
      createdAt: e.createdAt.toISOString(),
      payload: quoteEventPayload(e.payload),
    })),
  };
}
function withCosts(row: QuoteRow): QuoteInternalCostsDto {
  return {
    ...internalQuoteDto(row),
    audience: "internal-costs",
    versions: row.versions.map((v) => ({
      ...internalVersionDto(v),
      bomItems: v.bomItems.map((b) => ({
        ...bomLineDto(b),
        unitCost: b.unitCost?.toString() ?? null,
        costCurrency: b.costCurrency,
        costOriginal: b.costOriginal?.toString() ?? null,
        exchangeRate: b.exchangeRate?.toString() ?? null,
        costSource: b.costSource,
        costSourceDate: b.costSourceDate?.toISOString() ?? null,
        sourcePurchaseInvoiceLineId: b.sourcePurchaseInvoiceLineId,
        supplierId: b.supplierId,
        supplierSku: b.supplierSku,
        internalNote: b.internalNote,
      })),
    })),
  };
}
/** The privileged output requires effective permissions (including per-user revocations). */
export function quoteDto(
  row: QuoteRow,
  user: AuthenticatedUser,
): QuoteDetailDto {
  return hasPermission(user, PERMISSIONS.QUOTES_COSTS_VIEW)
    ? withCosts(row)
    : internalQuoteDto(row);
}
