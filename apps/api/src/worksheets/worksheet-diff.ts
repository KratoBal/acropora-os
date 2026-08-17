import type { WorksheetFieldChange } from "@acropora/types";

/**
 * Két verzió összehasonlítható alakja. Szándékosan csak szöveg: a diff a
 * dokumentumon LÁTHATÓ értékeket hasonlítja össze, nem a tárolt típusokat -
 * `12.00` és `12.000000` ugyanaz a tétel, nem módosítás.
 */
export interface ComparableWorksheetLine {
  position: number;
  description: string;
  detail: string | null;
  assetNumber: string | null;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  netAmount: string;
}

export interface ComparableWorksheetVersion {
  subject: string;
  unitText: string | null;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  lines: readonly ComparableWorksheetLine[];
}

const HEADER_FIELDS: ReadonlyArray<{
  field: keyof Omit<ComparableWorksheetVersion, "lines">;
  label: string;
}> = [
  { field: "subject", label: "Tárgy" },
  { field: "unitText", label: "Egység" },
  { field: "description", label: "Leírás" },
  { field: "issueDate", label: "Keltezés" },
  { field: "fulfillmentDate", label: "Teljesítés" },
  { field: "dueDate", label: "Határidő" },
  { field: "currency", label: "Pénznem" },
  { field: "netAmount", label: "Nettó összeg" },
  { field: "vatAmount", label: "ÁFA összeg" },
  { field: "grossAmount", label: "Bruttó összeg" },
];

const LINE_FIELDS: ReadonlyArray<{
  field: keyof Omit<ComparableWorksheetLine, "position">;
  label: string;
}> = [
  { field: "description", label: "megnevezés" },
  { field: "detail", label: "kiegészítő sor" },
  { field: "assetNumber", label: "eszköz" },
  { field: "quantity", label: "mennyiség" },
  { field: "unit", label: "mértékegység" },
  { field: "unitNet", label: "egységár" },
  { field: "vatRatePercent", label: "ÁFA-kulcs" },
  { field: "netAmount", label: "nettó összeg" },
];

function normalizeNumeric(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const trimmed = value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
  return trimmed === "-0" ? "0" : trimmed;
}

function sameValue(previous: string | null, current: string | null): boolean {
  if (previous === null || current === null) return previous === current;
  return normalizeNumeric(previous) === normalizeNumeric(current);
}

function lineSummary(line: ComparableWorksheetLine): string {
  return `${line.description} (${normalizeNumeric(line.quantity)} ${line.unit})`;
}

/**
 * A "mit módosítottak" nem tárolt másolat, hanem a két megváltoztathatatlan
 * verzióból számolt eltérés. Egy lementett diff idővel el tudna térni attól,
 * amit naplóz; ez nem tud.
 */
export function diffWorksheetVersions(
  previous: ComparableWorksheetVersion,
  current: ComparableWorksheetVersion,
): WorksheetFieldChange[] {
  const changes: WorksheetFieldChange[] = [];

  for (const { field, label } of HEADER_FIELDS) {
    const before = previous[field];
    const after = current[field];
    if (!sameValue(before, after)) {
      changes.push({ field, label, previous: before, current: after });
    }
  }

  const positions = new Set<number>([
    ...previous.lines.map((line) => line.position),
    ...current.lines.map((line) => line.position),
  ]);

  for (const position of [...positions].sort((a, b) => a - b)) {
    const before = previous.lines.find((line) => line.position === position);
    const after = current.lines.find((line) => line.position === position);

    if (before && !after) {
      changes.push({
        field: `lines.${position}`,
        label: `${position}. tétel`,
        previous: lineSummary(before),
        current: null,
      });
      continue;
    }
    if (!before && after) {
      changes.push({
        field: `lines.${position}`,
        label: `${position}. tétel`,
        previous: null,
        current: lineSummary(after),
      });
      continue;
    }
    if (!before || !after) continue;

    for (const { field, label } of LINE_FIELDS) {
      if (!sameValue(before[field], after[field])) {
        changes.push({
          field: `lines.${position}.${field}`,
          label: `${position}. tétel - ${label}`,
          previous: before[field],
          current: after[field],
        });
      }
    }
  }

  return changes;
}
