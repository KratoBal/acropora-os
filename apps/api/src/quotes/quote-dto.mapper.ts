import { Prisma } from "@acropora/database";
import {
  hasPermission,
  parseQuoteRichText,
  PERMISSIONS,
  type AuthenticatedUser,
  type QuoteCustomerDto,
  type QuoteCustomerVersion,
  type QuoteDetailDto,
  type QuoteHandoffSummaryDto,
  type QuoteListItemDto,
  type QuoteInternalVersion,
  type QuoteInternalDto,
  type QuoteInternalCostsDto,
  type QuoteBomLineDto,
  type QuoteRichText,
} from "@acropora/types";
import { isExpired } from "./quote-expiry.js";
import {
  allOptionsSelection,
  replacedItemIds,
} from "./quote-accepted-items.js";
import { quoteMoneyFixed } from "./pdf/quote-pdf-layout.js";
import type { QuoteListRow, QuoteRow } from "./quotes.repository.js";
export function quoteListItemDto(
  row: QuoteListRow,
  netTotals: ReadonlyMap<string, string> = new Map(),
  /** the exact gross sums per version (`QuotesRepository.grossTotals`); rounded here the PDF's way */
  grossTotals: ReadonlyMap<string, string> = new Map(),
  /** P8: computed by the list's own query (`expiredWhere`) */
  expired = false,
): QuoteListItemDto {
  const version = row.versions[0];
  return {
    id: row.id,
    isExpired: expired,
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
          grossTotal: quoteMoneyFixed(
            new Prisma.Decimal(grossTotals.get(version.id) ?? 0),
            version.currency,
          ),
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
    // P4a: enum values and a date, never a name or a note
    "source",
    "closeReason",
    "postponedUntil",
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
/** P6: the started project, from the handoff row (its plan holds the rest). */
export function handoffSummary(h: {
  executedAt: Date;
  plan: Prisma.JsonValue;
  executedBy: { displayName: string } | null;
  project: { id: string; projectNumber: string; name: string };
}): QuoteHandoffSummaryDto {
  const plan = record(h.plan);
  return {
    projectId: h.project.id,
    projectNumber: h.project.projectNumber,
    projectName: h.project.name,
    executedAt: h.executedAt.toISOString(),
    executedByName: h.executedBy?.displayName ?? null,
    materialRequestId:
      typeof plan?.materialRequestId === "string"
        ? plan.materialRequestId
        : null,
    reservationCount: Array.isArray(plan?.reservations)
      ? plan.reservations.length
      : 0,
  };
}
export function variantLabel(
  v: { sku: string; name: string | null; product: { name: string } } | null,
): string | null {
  if (!v) return null;
  return `${v.product.name}${v.name ? ` · ${v.name}` : ""} (${v.sku})`;
}
/**
 * Offered and optional net totals of a version, exact (P1), and their GROSS totals as the PDF counts them (Luca 2026-11-26, card
 * 7337010c: the editor's internal costing shows the gross beside the net): each line at its own VAT rate, summed unrounded, rounded once
 * by `quoteMoneyFixed` (the PDF's and the quote list's rule), so a mixed-rate quote's gross is the PDF's to the unit.
 */
function netTotals(v: QuoteRow["versions"][number]) {
  let offered = new Prisma.Decimal(0);
  let optional = new Prisma.Decimal(0);
  let offeredGross = new Prisma.Decimal(0);
  let optionalGross = new Prisma.Decimal(0);
  // KIVÁLTOTT TÉTEL (card 2540d9d4, Luca): az opciók összege az opciók HATÁSA az összegre: a helyükre lépő opció a kiváltott tétel árát vonja le,
  // nem hozzáadódik (150 000 + 30 000 + 20 000 helyett, ha a 30 000 az 50 000 helyére lép: 0). Kiváltás nélkül a sima összeg.
  // ALTERNATÍVÁK (Luca 2026-11-27): egy tételt kiváltó opciók kizárják egymást, ezért csoportonként a legdrágábbat számoljuk (a legnagyobb hatás).
  const all = v.blocks.flatMap((b) => b.items);
  const lineOf = (i: (typeof all)[number]) => i.quantity.times(i.unitNetPrice);
  const counted = new Set(
    allOptionsSelection(all, (a, b) => lineOf(a).greaterThan(lineOf(b))),
  );
  const replaced = replacedItemIds(all, counted);
  for (const i of all) {
    const line = lineOf(i);
    const gross = line.times(
      new Prisma.Decimal(1).plus(i.vatRatePercent.dividedBy(100)),
    );
    if (i.isOptional) {
      if (!counted.has(i.id)) continue;
      optional = optional.plus(line);
      optionalGross = optionalGross.plus(gross);
    } else {
      offered = offered.plus(line);
      offeredGross = offeredGross.plus(gross);
      if (replaced.has(i.id)) {
        optional = optional.minus(line);
        optionalGross = optionalGross.minus(gross);
      }
    }
  }
  return {
    netTotal: offered.toDecimalPlaces(4).toFixed(4),
    optionalNetTotal: optional.toDecimalPlaces(4).toFixed(4),
    grossTotal: quoteMoneyFixed(offeredGross, v.currency),
    optionalGrossTotal: quoteMoneyFixed(optionalGross, v.currency),
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
    proformas: v.milestones.flatMap((m) =>
      m.proformaInvoice
        ? [
            {
              milestoneId: m.id,
              invoiceId: m.proformaInvoice.id,
              status: m.proformaInvoice.status,
            },
          ]
        : [],
    ),
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
        replacesItemId: v.blocks[index]!.items[itemIndex]!.replacesItemId,
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
    closeReason: row.closeReason,
    closeNote: row.closeNote,
    postponedUntil: row.postponedUntil?.toISOString().slice(0, 10) ?? null,
    acceptedVersionId: row.acceptedVersionId,
    handoff: row.handoff ? handoffSummary(row.handoff) : null,
    isExpired: isExpired(row.status, row.versions),
    acceptances: row.acceptances.map((a) => ({
      id: a.id,
      versionId: a.quoteVersionId,
      versionNumber: a.version.versionNumber,
      source: a.source,
      acceptedAt: a.acceptedAt.toISOString().slice(0, 10),
      acceptedByName: a.acceptedByName,
      acceptedByEmail: a.acceptedByEmail,
      recordedByName: a.recordedBy?.displayName ?? null,
      selectedOptionalItemIds: a.selectedOptionalItemIds,
      note: a.note,
      createdAt: a.createdAt.toISOString(),
      revokedAt: a.revokedAt?.toISOString() ?? null,
      revokedByName: a.revokedBy?.displayName ?? null,
      revokeReason: a.revokeReason,
    })),
    deliveries: row.mailDeliveries.map((d) => {
      const r = record(d.recipients);
      const list = (key: string) =>
        Array.isArray(r?.[key])
          ? (r![key] as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
      return {
        id: d.id,
        versionId: d.quoteVersionId,
        versionNumber: d.version.versionNumber,
        to: list("to"),
        cc: list("cc"),
        bcc: list("bcc"),
        subject: d.subject,
        outcome: d.outcome as "SENT" | "FAILED" | "INDETERMINATE",
        error: d.error,
        isResend: d.isResend,
        redirectedTo: d.redirectedTo,
        initiatedByName: d.initiatedBy?.displayName ?? null,
        createdAt: d.createdAt.toISOString(),
      };
    }),
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
