import { Prisma, type PrismaClient } from "@acropora/database";

import { IncomingRowNotFoundError } from "./incoming-not-bookable.js";
import { incomingRowFor, lockIncomingKeys } from "./purchase-incoming.js";

/**
 * A JÓVÁHAGYOTT POSTAFIÓKOS SOR SZÁMÁNAK JAVÍTÁSA (acrobot 49617, niceshops: a 97 265 Ft-os R49010000026241578 a
 * 338 018 Ft-os R49010000026240667 számával lett jóváhagyva, és a két számla egy kulcson állt). Eddig nem volt rá út: a
 * jóváhagyott sor nem szerkeszthető, és visszavonni sem lehetett.
 *
 * CSAK A POSTAFIÓKOS (MAILBOX) SOR: a Számlázz.hu-sor a feedből jön (a következő vetítés visszaírná), a beszerzési sor a
 * beszerzési számlát tükrözi. A sor számát és keltét írja, és a jóváhagyott olvasatét is, hogy a kettő ne mondjon ellent
 * egymásnak. A BANKI PÁROSÍTÁS NEM MOZDUL: az a dokumentumhoz köt (BankTransactionMatch.documentId), nem a sorhoz.
 *
 * A RÉGI ÉS AZ ÚJ KULCS ZÁRJA egy rendezett sorrendben (`lockIncomingKeys`, a holtpont ellen), és ha az új kulcson
 * (szám és szállító) már van MÁSIK sor, nem ír: ugyanaz az őr, mint a jóváhagyásnál (#2496). Auditsor a régi és az új
 * értékkel; ugyanazt újra beállítani nem ír semmit.
 *
 * A SOR ZÁRJA ELŐBB, AZ OLVASÁS UTÁNA (barracuda a #2496-on): a sor `FOR NO KEY UPDATE` zárja jön az olvasás előtt, a
 * kulcsoké utána. Enélkül két egyidejű javítás ugyanazon a soron a régi számot olvasta: a második a kulcs zárján várt,
 * de a naplóba a már felülírt számot írta `from`-nak, és a régi kulcsot zárta a valódi helyett. A sorrend nem okoz
 * holtpontot: egyik út sem veszi a kulcs zárját úgy, hogy utána egy MEGLÉVŐ postafiókos sort írna (a jóváhagyás új sort
 * hoz létre, a Számlázz.hu-vetítés a saját sorát írja, a beszerzés a beszerzési sort törli).
 */

/** Csak postafiókos sor száma javítható. */
export class IncomingNumberNotCorrectableError extends Error {
  constructor() {
    super(
      "Csak a postafiókból jóváhagyott számla száma javítható itt; a Számlázz.hu-ból és a beszerzésből jött sor a forrásából frissül.",
    );
    this.name = "IncomingNumberNotCorrectableError";
  }
}

/** Az új szám (a szállítóval) már egy másik bent lévő számláé. */
export class IncomingNumberTakenError extends Error {
  constructor(source: string) {
    super(
      `Ez a számlaszám ennél a szállítónál már egy másik bent lévő számláé (${source}): ellenőrizd a számot.`,
    );
    this.name = "IncomingNumberTakenError";
  }
}

const day = (date: Date) => date.toISOString().slice(0, 10);

export async function correctIncomingNumber(
  database: Pick<
    PrismaClient,
    | "incomingBillingDocument"
    | "incomingDocumentReading"
    | "auditLog"
    | "$transaction"
  >,
  input: {
    rowId: string;
    documentNumber: string;
    issueDate: Date;
    userId: string;
  },
): Promise<{ changed: boolean }> {
  const number = input.documentNumber.trim();
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "IncomingBillingDocument" WHERE "id" = ${input.rowId} FOR NO KEY UPDATE`;
    const row = await tx.incomingBillingDocument.findUnique({
      where: { id: input.rowId },
      select: {
        id: true,
        source: true,
        documentNumber: true,
        issueDate: true,
        supplierTaxNumber: true,
        supplierEuTaxNumber: true,
        supplierName: true,
      },
    });
    if (!row) throw new IncomingRowNotFoundError();
    if (row.source !== "MAILBOX") throw new IncomingNumberNotCorrectableError();
    if (
      row.documentNumber === number &&
      day(row.issueDate) === day(input.issueDate)
    )
      return { changed: false };
    const [, key] = await lockIncomingKeys(tx, [
      row,
      { ...row, documentNumber: number },
    ]);
    const taken = key
      ? await incomingRowFor(tx, number, key, null, row.id)
      : null;
    if (taken) throw new IncomingNumberTakenError(taken.source);
    // the old values for the audit, taken before the write
    const from = {
      documentNumber: row.documentNumber,
      issueDate: day(row.issueDate),
    };
    await tx.incomingBillingDocument.update({
      where: { id: row.id },
      data: { documentNumber: number, issueDate: input.issueDate },
    });
    await tx.incomingDocumentReading.updateMany({
      where: { incomingBillingDocumentId: row.id },
      data: { documentNumber: number, issueDate: input.issueDate },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.incoming-number.corrected",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: {
          from,
          to: { documentNumber: number, issueDate: day(input.issueDate) },
        } satisfies Prisma.InputJsonObject,
      },
    });
    return { changed: true };
  });
}
