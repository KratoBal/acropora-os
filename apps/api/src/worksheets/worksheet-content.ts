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
  /**
   * Az ár és az összegek EGYÜTT vannak meg, vagy EGYÜTT hiányoznak - a
   * `priceOf` fejléce mondja meg, miért nincs köztes állapot. A `null` a
   * kitöltetlenség; a nulla egy elvégzett, ingyenes munka volna.
   */
  unitNet: Prisma.Decimal | null;
  vatRatePercent: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
  vatAmount: Prisma.Decimal | null;
  grossAmount: Prisma.Decimal | null;
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
    ...priceOf(line),
  };
}

/**
 * AZ ÁR ÉS AZ ÖSSZEGEK EGYÜTT VANNAK MEG, VAGY EGYÜTT HIÁNYOZNAK.
 *
 * Nincs olyan állapot, hogy van egységár, de nincs összeg - az összeg abból
 * számol. És nincs olyan sem, hogy fél áron áll a sor: ha az egységár vagy az
 * áfakulcs bármelyike hiányzik, a másikból sem lehet összeget képezni, tehát
 * a sor ÁR NÉLKÜLINEK számít.
 *
 * A HIÁNY `null`, NEM NULLA. A nulla egy elvégzett, ingyenes munka; a `null`
 * az, hogy még nincs kitöltve. A kettő összemosása azt jelentené, hogy a
 * lapra ránézve nem lehet megkülönböztetni őket - és semmi nem szólna, ha
 * valaki elfelejti kitölteni.
 */
/**
 * Van-e a soron ár, tehát számít-e bele a lap összegébe.
 *
 * Generikus, hogy a szűrt tömb megtartsa a sor TÖBBI mezőjét is: egy szűkebb
 * paraméter-típussal a `filter` a három összeg-mezőre szűkítené az elemeket,
 * és a hívó elveszítené a leírást meg a mennyiséget.
 */
function hasPrice<
  T extends {
    netAmount: Prisma.Decimal | null;
    vatAmount: Prisma.Decimal | null;
    grossAmount: Prisma.Decimal | null;
  },
>(
  line: T,
): line is T & {
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
} {
  return (
    line.netAmount !== null &&
    line.vatAmount !== null &&
    line.grossAmount !== null
  );
}

function priceOf(line: WorksheetLineDto) {
  if (line.unitNet === undefined || line.vatRatePercent === undefined) {
    return {
      unitNet: null,
      vatRatePercent: null,
      netAmount: null,
      vatAmount: null,
      grossAmount: null,
    };
  }
  return {
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
    // AZ ÁR NÉLKÜLI SOR KIMARAD AZ ÖSSZEGZÉSBŐL, nem nullaként számít bele.
    // Egy nullával beszámított tétel azt állítaná, hogy az összeg KÉSZ, csak
    // épp ennyi. Kihagyva az összeg annyit mond, amennyit tud - a hiányról a
    // lezárás szól, ami ár nélküli sorral nem engedi tovább a lapot.
    totals: sumWorksheetAmounts(lines.filter(hasPrice)),
  };
}
