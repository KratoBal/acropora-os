import { Prisma } from "@acropora/database";

import {
  computeWorksheetLineAmounts,
  sumWorksheetAmounts,
  type WorksheetAmounts,
} from "./worksheet-amounts.js";
import type {
  WorksheetContentDto,
  WorksheetLineDto,
} from "./dto/worksheet.dto.js";

export interface NormalizedWorksheetLine {
  position: number;
  description: string;
  detail: string | null;
  assetId: string | null;
  quantity: Prisma.Decimal;
  unit: string;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

export interface NormalizedWorksheetContent {
  subject: string;
  description: string | null;
  issueDate: Date | null;
  fulfillmentDate: Date | null;
  dueDate: Date | null;
  lines: NormalizedWorksheetLine[];
  totals: WorksheetAmounts;
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

/**
 * A keltezés, a teljesítés és a határidő a dokumentumon dátum, nem időpont.
 * Ha időpontos érték érkezik, a napját tartjuk meg: egy időzóna-eltolás
 * különben egy nappal odébb tolhatná a teljesítést a nyomtatott lapon.
 */
export function toDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("WORKSHEET_DATE_INVALID");
  }
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("WORKSHEET_DATE_INVALID");
  return parsed;
}

/**
 * A tételek sorszámát a beküldött sorrend adja, az összegeket pedig a
 * szerver számolja. A kliens által küldött összeg szándékosan nincs is a
 * bemenetben: egy számlát alapozó dokumentumon nem a böngésző dönti el,
 * mennyi a nettó.
 */
/**
 * Egy sor normalizálása a lap többi tartalma nélkül, a sor-szintű
 * végpontokhoz.
 *
 * A sorszám itt szándékosan hiányzik: azt a tárolóréteg osztja ki a
 * tranzakción belül. Ha a kliens küldené, két egyszerre rögzítő telefon
 * ugyanazt a számot kérné, és az egyedi megszorítás egyiküket eldobná.
 */
export function normalizeWorksheetLine(
  line: WorksheetLineDto,
): Omit<NormalizedWorksheetLine, "position"> {
  return {
    description: line.description.trim(),
    detail: optionalText(line.detail),
    assetId: line.assetId?.trim() || null,
    quantity: new Prisma.Decimal(line.quantity),
    unit: line.unit.trim(),
    unitNet: new Prisma.Decimal(line.unitNet),
    vatRatePercent: new Prisma.Decimal(line.vatRatePercent),
    ...computeWorksheetLineAmounts({
      quantity: line.quantity,
      unitNet: line.unitNet,
      vatRatePercent: line.vatRatePercent,
    }),
  };
}

export function normalizeWorksheetContent(
  input: WorksheetContentDto,
): NormalizedWorksheetContent {
  const lines = input.lines.map((line, index) => ({
    position: index + 1,
    ...normalizeWorksheetLine(line),
  }));

  return {
    subject: input.subject.trim(),
    description: optionalText(input.description),
    issueDate: toDateOnly(input.issueDate),
    fulfillmentDate: toDateOnly(input.fulfillmentDate),
    dueDate: toDateOnly(input.dueDate),
    lines,
    totals: sumWorksheetAmounts(lines),
  };
}
