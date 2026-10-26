import type { PrismaClient } from "@acropora/database";

/**
 * „NEM KÖNYVELENDŐ” (Balázs, Acropora OS szál, 2026-10-26): egy bejövő számla
 * kézi, egyenkénti jelölése. A jelölt számla nem kerül a könyvelői anyagba, a
 * hiányzó számlák számításába és a kimutatásokba (`missing-invoices.repository`
 * `candidates`), a listában a Fizetés oszlopban „Nem könyv.” áll.
 *
 * VISSZAVONHATÓ, és az auditnapló mondja meg, ki és mikor tette: a jelölés egy
 * döntés, nem adat. Ugyanazt az értéket újra beállítani nem ír semmit (nincs
 * üres audit-sor). A jelölt számlához addig párosított banki terhelések a
 * Hiányzó számlák között újra hiányzóként jelennek meg, mert a számla a
 * számítás szempontjából megszűnt; az auditsor ezt a darabszámot is rögzíti.
 */
export class IncomingRowNotFoundError extends Error {
  constructor() {
    super("Nincs ilyen bejövő számla.");
    this.name = "IncomingRowNotFoundError";
  }
}

export async function setIncomingNotBookable(
  database: Pick<
    PrismaClient,
    "incomingBillingDocument" | "auditLog" | "$transaction"
  >,
  input: {
    rowId: string;
    notBookable: boolean;
    userId: string;
    /** a számlához ma párosított banki terhelések száma (a hívó számolja a párosításból) */
    pairedDebits: number;
    now?: Date;
  },
): Promise<{ changed: boolean }> {
  return database.$transaction(async (tx) => {
    const row = await tx.incomingBillingDocument.findUnique({
      where: { id: input.rowId },
      select: { id: true, documentNumber: true, notBookable: true },
    });
    if (!row) throw new IncomingRowNotFoundError();
    if (row.notBookable === input.notBookable) return { changed: false };
    await tx.incomingBillingDocument.update({
      where: { id: row.id },
      data: {
        notBookable: input.notBookable,
        notBookableAt: input.notBookable ? (input.now ?? new Date()) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.notBookable
          ? "billing.incoming-not-bookable.set"
          : "billing.incoming-not-bookable.cleared",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: {
          documentNumber: row.documentNumber,
          pairedDebits: input.pairedDebits,
        },
      },
    });
    return { changed: true };
  });
}
