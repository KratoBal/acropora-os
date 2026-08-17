import type { Prisma } from "@acropora/database";
import {
  formatWorksheetVersionLabel,
  type WorksheetDetail,
  type WorksheetListItem,
  type WorksheetSignatureDetail,
  type WorksheetVersionDetail,
  type WorksheetVersionSummary,
} from "@acropora/types";

import type { ComparableWorksheetVersion } from "./worksheet-diff.js";

export const worksheetVersionInclude = {
  lines: {
    include: { asset: { select: { assetNumber: true } } },
    orderBy: { position: "asc" as const },
  },
  createdBy: { select: { displayName: true } },
  closedBy: { select: { displayName: true } },
  signature: { include: { signedBy: { select: { displayName: true } } } },
} satisfies Prisma.WorksheetVersionInclude;

export const worksheetDetailInclude = {
  customer: {
    select: {
      id: true,
      customerNumber: true,
      displayName: true,
      worksheetPartnerCode: true,
    },
  },
  department: {
    select: { id: true, code: true, name: true, isActive: true },
  },
  createdBy: { select: { displayName: true } },
  versions: {
    include: worksheetVersionInclude,
    orderBy: { version: "desc" as const },
  },
} satisfies Prisma.WorksheetInclude;

export const worksheetSummaryInclude = {
  customer: { select: { displayName: true } },
  department: { select: { code: true } },
  versions: {
    select: {
      version: true,
      status: true,
      subject: true,
      grossAmount: true,
    },
    orderBy: { version: "desc" as const },
    take: 1,
  },
  _count: { select: { versions: true } },
} satisfies Prisma.WorksheetInclude;

export type WorksheetDetailRow = Prisma.WorksheetGetPayload<{
  include: typeof worksheetDetailInclude;
}>;

export type WorksheetSummaryRow = Prisma.WorksheetGetPayload<{
  include: typeof worksheetSummaryInclude;
}>;

export type WorksheetVersionRow = WorksheetDetailRow["versions"][number];

/** A `@db.Date` oszlop UTC éjfélként jön vissza; a dokumentumon dátum van, nem időpont. */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toSignatureDetail(
  row: WorksheetVersionRow["signature"],
): WorksheetSignatureDetail | null {
  if (!row) return null;
  return {
    decision: row.decision,
    signerName: row.signerName,
    signedByName: row.signedBy?.displayName ?? null,
    signedAt: row.signedAt.toISOString(),
    note: row.note,
  };
}

export function toVersionSummary(
  row: WorksheetVersionRow,
  worksheetNumber: string | null,
): WorksheetVersionSummary {
  return {
    id: row.id,
    version: row.version,
    label: formatWorksheetVersionLabel(worksheetNumber, row.version),
    status: row.status,
    changeReason: row.changeReason,
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closedByName: row.closedBy?.displayName ?? null,
    netAmount: row.netAmount.toString(),
    vatAmount: row.vatAmount.toString(),
    grossAmount: row.grossAmount.toString(),
    signature: toSignatureDetail(row.signature),
  };
}

export function toVersionDetail(
  row: WorksheetVersionRow,
  worksheetNumber: string | null,
): WorksheetVersionDetail {
  return {
    ...toVersionSummary(row, worksheetNumber),
    subject: row.subject,
    unitText: row.unitText,
    description: row.description,
    issueDate: toDateOnly(row.issueDate),
    fulfillmentDate: toDateOnly(row.fulfillmentDate),
    dueDate: toDateOnly(row.dueDate),
    currency: row.currency,
    lines: row.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      detail: line.detail,
      assetId: line.assetId,
      assetNumber: line.asset?.assetNumber ?? null,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitNet: line.unitNet.toString(),
      vatRatePercent: line.vatRatePercent.toString(),
      netAmount: line.netAmount.toString(),
      vatAmount: line.vatAmount.toString(),
      grossAmount: line.grossAmount.toString(),
    })),
  };
}

/** A verziók sorrendje csökkenő, tehát a lap mai állapota az első elem. */
export function currentVersionRow(
  row: WorksheetDetailRow,
): WorksheetVersionRow {
  const current = row.versions[0];
  if (!current) throw new Error("WORKSHEET_WITHOUT_VERSION");
  return current;
}

export function toWorksheetDetail(row: WorksheetDetailRow): WorksheetDetail {
  const current = currentVersionRow(row);
  return {
    id: row.id,
    number: row.number,
    numberYear: row.numberYear,
    sequence: row.sequence,
    customer: {
      id: row.customer.id,
      customerNumber: row.customer.customerNumber,
      displayName: row.customer.displayName,
      worksheetPartnerCode: row.customer.worksheetPartnerCode,
    },
    department: {
      id: row.department.id,
      code: row.department.code,
      name: row.department.name,
      isActive: row.department.isActive,
    },
    createdByName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    currentVersion: toVersionDetail(current, row.number),
    versions: row.versions.map((version) =>
      toVersionSummary(version, row.number),
    ),
  };
}

export function toWorksheetListItem(
  row: WorksheetSummaryRow,
): WorksheetListItem {
  const current = row.versions[0];
  if (!current) throw new Error("WORKSHEET_WITHOUT_VERSION");
  return {
    id: row.id,
    number: row.number,
    label: formatWorksheetVersionLabel(row.number, current.version),
    customerName: row.customer.displayName,
    departmentCode: row.department.code,
    subject: current.subject,
    status: current.status,
    version: current.version,
    versionCount: row._count.versions,
    grossAmount: current.grossAmount.toString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toComparableVersion(
  row: WorksheetVersionRow,
): ComparableWorksheetVersion {
  return {
    subject: row.subject,
    unitText: row.unitText,
    description: row.description,
    issueDate: toDateOnly(row.issueDate),
    fulfillmentDate: toDateOnly(row.fulfillmentDate),
    dueDate: toDateOnly(row.dueDate),
    currency: row.currency,
    netAmount: row.netAmount.toString(),
    vatAmount: row.vatAmount.toString(),
    grossAmount: row.grossAmount.toString(),
    lines: row.lines.map((line) => ({
      position: line.position,
      description: line.description,
      detail: line.detail,
      assetNumber: line.asset?.assetNumber ?? null,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitNet: line.unitNet.toString(),
      vatRatePercent: line.vatRatePercent.toString(),
      netAmount: line.netAmount.toString(),
    })),
  };
}
