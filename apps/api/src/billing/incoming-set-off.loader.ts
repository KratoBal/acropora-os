import type { IncomingBillingDocument } from "@acropora/database";
import { Prisma, prisma } from "@acropora/database";

import { foxpostNarrativeMark } from "../integrations/foxpost/foxpost-paid-marks.js";
import { codNarrativePrefix } from "../integrations/gls/gls-cod-paid-marks.dry-run.js";
import {
  incomingSetOffPayments,
  type SetOffPayment,
} from "./incoming-set-off.js";

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * A FUTÁR LEVONÁSÁVAL KIFIZETETT BEJÖVŐ SZÁMLÁK (lásd `incoming-set-off.ts`): a Foxpost-elszámolások, a GLS beszámítási levelek és a hozzájuk tartozó
 * banki jóváírások az adatbázisból, csak olvasás. A kulcs a bejövő számla száma. Csak azokat az elszámolásokat és leveleket olvassa, amelyek a
 * megadott sorok valamelyikét nevezik meg, tehát a lista költsége a sorok számával nő, nem az elszámolásokéval.
 */
export async function loadSetOffPayments(
  rows: readonly Pick<
    IncomingBillingDocument,
    "documentNumber" | "grossAmount" | "currency"
  >[],
): Promise<Map<string, SetOffPayment>> {
  const numbers = [...new Set(rows.map((row) => row.documentNumber))];
  if (numbers.length === 0) return new Map();
  const [settlements, letters] = await Promise.all([
    prisma.foxpostSettlement.findMany({
      where: { invoiceNumber: { in: numbers } },
      select: {
        settlementCode: true,
        status: true,
        invoiceNumber: true,
        invoiceGrossAmount: true,
        collectedAmount: true,
        transferredAmount: true,
        currency: true,
        lines: { select: { collectedAmount: true } },
      },
    }),
    prisma.glsCompensationLetter.findMany({
      where: { references: { hasSome: numbers } },
      select: {
        compensationDate: true,
        currency: true,
        cod: true,
        compensated: true,
        transferred: true,
        remaining: true,
        references: true,
      },
    }),
  ]);
  const settlementCodes = settlements.flatMap((s) =>
    s.settlementCode ? [s.settlementCode] : [],
  );
  const letterDays = [...new Set(letters.map((l) => day(l.compensationDate)))];
  const [foxpostCredits, glsCredits, reports] = await Promise.all([
    settlementCodes.length === 0
      ? Promise.resolve([])
      : prisma.bankTransaction.findMany({
          where: {
            direction: "CREDIT",
            duplicateMarkedAt: null,
            OR: settlementCodes.map((code) => ({
              narrative: { startsWith: foxpostNarrativeMark(code) },
            })),
          },
          select: { amount: true, bookingDate: true, narrative: true },
        }),
    letterDays.length === 0
      ? Promise.resolve([])
      : prisma.bankTransaction.findMany({
          where: {
            direction: "CREDIT",
            duplicateMarkedAt: null,
            OR: letterDays.map((d) => ({
              bookingDate: new Date(`${d}T00:00:00Z`),
              narrative: { startsWith: codNarrativePrefix(d) },
            })),
          },
          select: { amount: true, bookingDate: true },
        }),
    letterDays.length === 0
      ? Promise.resolve([])
      : prisma.glsCodReport.findMany({
          where: {
            transferDate: {
              in: letterDays.map((d) => new Date(`${d}T00:00:00Z`)),
            },
          },
          select: { transferDate: true, total: true },
        }),
  ]);
  return incomingSetOffPayments({
    foxpost: settlements.map((s) => ({
      settlementCode: s.settlementCode,
      status: s.status,
      invoiceNumber: s.invoiceNumber,
      invoiceGrossAmount: s.invoiceGrossAmount,
      collectedAmount: s.collectedAmount,
      transferredAmount: s.transferredAmount,
      currency: s.currency,
      lineSum: s.lines.reduce(
        (sum, line) => sum.plus(line.collectedAmount),
        new Prisma.Decimal(0),
      ),
      credits: foxpostCredits
        .filter((c) =>
          s.settlementCode
            ? c.narrative.startsWith(foxpostNarrativeMark(s.settlementCode))
            : false,
        )
        .map((c) => ({ amount: c.amount, bookingDate: day(c.bookingDate) })),
    })),
    gls: letters.map((l) => {
      const d = day(l.compensationDate);
      return {
        day: d,
        currency: l.currency,
        cod: l.cod,
        compensated: l.compensated,
        transferred: l.transferred,
        remaining: l.remaining,
        references: l.references,
        reportTotal:
          reports.find((r) => day(r.transferDate) === d)?.total ?? null,
        credits: glsCredits
          .filter((c) => day(c.bookingDate) === d)
          .map((c) => ({ amount: c.amount })),
      };
    }),
    invoices: new Map(
      rows.map((row) => [
        row.documentNumber,
        { gross: row.grossAmount, currency: row.currency },
      ]),
    ),
  });
}
