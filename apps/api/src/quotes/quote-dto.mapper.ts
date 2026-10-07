import { Prisma } from "@acropora/database";
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type QuoteCustomerDto,
  type QuoteCustomerVersion,
  type QuoteDetailDto,
  type QuoteListItemDto,
  type QuoteInternalVersion,
  type QuoteInternalDto,
  type QuoteInternalCostsDto,
  type QuoteRichText,
} from "@acropora/types";
import type { QuoteListRow } from "./quotes.repository.js";
export function quoteListItemDto(row: QuoteListRow): QuoteListItemDto {
  const version = row.versions[0];
  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    title: row.title,
    status: row.status,
    customerId: row.customerId,
    ownerUserId: row.ownerUserId,
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
        }
      : null,
  };
}
export const QUOTE_DETAIL_INCLUDE = {
  versions: {
    orderBy: { versionNumber: "asc" },
    include: {
      blocks: {
        orderBy: { position: "asc" },
        include: { items: { orderBy: { position: "asc" } } },
      },
      bomItems: { orderBy: [{ quoteItemId: "asc" }, { position: "asc" }] },
      milestones: { orderBy: { position: "asc" } },
    },
  },
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.QuoteInclude;
export type QuoteRow = Prisma.QuoteGetPayload<{
  include: typeof QUOTE_DETAIL_INCLUDE;
}>;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
/** Read-side allowlist: no arbitrary JSON is reflected into the customer or cost-free DTO.
 * P1 owns editor validation; P0 owns safe serialization even of legacy/untrusted JSON. */
export function quoteText(value: unknown, depth = 0): QuoteRichText | null {
  const n = record(value);
  if (!n || depth > 24 || typeof n.type !== "string") return null;
  const types = [
    "doc",
    "paragraph",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "hardBreak",
  ] as const;
  if (!types.includes(n.type as (typeof types)[number])) return null;
  if (
    Object.keys(n).some(
      (k) => !["type", "text", "marks", "content"].includes(k),
    )
  )
    return null;
  const result: QuoteRichText = { type: n.type as QuoteRichText["type"] };
  if (result.type === "text") {
    if (typeof n.text !== "string") return null;
    result.text = n.text;
    if (Array.isArray(n.marks)) {
      const marks = n.marks.map((m) => {
        const r = record(m);
        return r &&
          Object.keys(r).every((k) => k === "type") &&
          (r.type === "bold" || r.type === "italic")
          ? { type: r.type as "bold" | "italic" }
          : null;
      });
      if (marks.some((m) => m === null)) return null;
      if (marks.length)
        result.marks = marks as NonNullable<QuoteRichText["marks"]>;
    }
  }
  if (Array.isArray(n.content)) {
    const children = n.content.map((c) => quoteText(c, depth + 1));
    if (children.some((c) => c === null)) return null;
    result.content = children as QuoteRichText[];
  }
  return result;
}
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
function internalVersionDto(
  v: QuoteRow["versions"][number],
): QuoteInternalVersion {
  const dto = versionDto(v);
  return {
    ...dto,
    templateId: v.templateId,
    createdFromVersionId: v.createdFromVersionId,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    blocks: dto.blocks.map((b, index) => ({
      ...b,
      sourceSnippetId: v.blocks[index]!.sourceSnippetId,
      items: b.items.map((i, itemIndex) => ({
        ...i,
        source: v.blocks[index]!.items[itemIndex]!.source,
        variantId: v.blocks[index]!.items[itemIndex]!.variantId,
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
        id: b.id,
        quoteItemId: b.quoteItemId,
        position: b.position,
        kind: b.kind,
        variantId: b.variantId,
        customName: b.customName,
        quantity: b.quantity.toString(),
        unit: b.unit,
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
        createdProductVariantId: b.createdProductVariantId,
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
