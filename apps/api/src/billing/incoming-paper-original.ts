import type { PrismaClient } from "@acropora/database";

import { IncomingRowNotFoundError } from "./incoming-not-bookable.js";

/**
 * „PAPÍRON MEGVAN” A BEJÖVŐ SZÁMLÁN (Balázs, Acropora OS szál, 2026-11-02): a
 * számlát papíron is megkapjuk, ezért a PDF-je nem kerül a könyvelői csomagba,
 * a borítón „papíron megvan” áll. A Hiányzó számlák sorain ugyanez a jelölés
 * már él (#2000, `BankTransaction.paperOriginalAt`); a bejövő számla sora ezt a
 * párosított terhelésén át örökli, ez pedig a SORON álló saját jelölés, hogy a
 * még ki nem fizetett számla is jelölhető legyen.
 *
 * VISSZAVONHATÓ, és az auditnapló mondja meg, ki és mikor tette. Ugyanazt az
 * értéket újra beállítani nem ír semmit (nincs üres audit-sor).
 */
export async function setIncomingPaperOriginal(
  database: Pick<
    PrismaClient,
    "incomingBillingDocument" | "auditLog" | "$transaction"
  >,
  input: {
    rowId: string;
    marked: boolean;
    userId: string;
    now?: Date;
  },
): Promise<{ changed: boolean }> {
  return database.$transaction(async (tx) => {
    const row = await tx.incomingBillingDocument.findUnique({
      where: { id: input.rowId },
      select: { id: true, documentNumber: true, paperOriginalAt: true },
    });
    if (!row) throw new IncomingRowNotFoundError();
    if ((row.paperOriginalAt !== null) === input.marked)
      return { changed: false };
    await tx.incomingBillingDocument.update({
      where: { id: row.id },
      data: {
        paperOriginalAt: input.marked ? (input.now ?? new Date()) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.marked
          ? "billing.incoming-paper-original.set"
          : "billing.incoming-paper-original.cleared",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: { documentNumber: row.documentNumber },
      },
    });
    return { changed: true };
  });
}
