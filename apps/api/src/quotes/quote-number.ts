import { Prisma } from "@acropora/database";

/**
 * The next quote number, `AJ-<year, Budapest>-<sequence, 4 digits>`. One place
 * for the new quote and for the copy of a closed quote; the sequence is
 * database-wide, so a deleted draft leaves a gap and a number is never reused.
 */
export async function nextQuoteNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const [seq] = await tx.$queryRaw<Array<{ value: bigint }>>(
    Prisma.sql`SELECT nextval('"QuoteNumberSequence"') AS value`,
  );
  if (!seq) throw new Error("QUOTE_NUMBER_SEQUENCE_FAILED");
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Budapest",
    year: "numeric",
  }).format(new Date());
  return `AJ-${year}-${seq.value.toString().padStart(4, "0")}`;
}
