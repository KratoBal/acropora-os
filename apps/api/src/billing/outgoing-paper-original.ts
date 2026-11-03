import type { PrismaClient } from "@acropora/database";

/** Nincs ilyen kimenő számla (a saját bizonylatnál: nem kimenő, vagy nincs). */
export class OutgoingDocumentNotFoundError extends Error {
  constructor() {
    super("A kimenő számla nem található.");
  }
}

/** Vázlat vagy elvetett bizonylat: annak nincs PDF-je a csomagban, nincs mit papírra tenni. */
export class OutgoingDocumentNotIssuedError extends Error {
  constructor() {
    super("Csak kiállított számla jelölhető, hogy papíron megvan.");
  }
}

/**
 * „PAPÍRON MEGVAN” A KIMENŐ SZÁMLÁN (Balázs, Acropora OS szál, 2026-11-03 07:22 UTC: „a szamlazas kimeno
 * szamlakhoz kellene egy ugyanolyan gomb a szamlahoz mint a bejovonel Megvan papiron. Aminel beallitjuk azt
 * nem kell belerakni a hianyzo szamlak Kimeno szamlak csomagba”). A bejövő számla jelölésének (#2006,
 * `setIncomingPaperOriginal`) párja: a jelölt számla PDF-je nem kerül a havi kimenő csomagba, a borítón
 * „papíron megvan” áll, és nem számít PDF nélkülinek.
 *
 * A kimenő listán kétféle sor van, ezért két tábla: a saját (OS-ben kiállított) számla az `Invoice`, a
 * Számlázz.hu vagy az eBIZ által hozott a `ExternalBillingDocument`.
 *
 * VISSZAVONHATÓ, és az auditnapló mondja meg, ki és mikor tette. Ugyanazt az értéket újra beállítani nem ír
 * semmit (nincs üres audit-sor).
 */
export async function setOutgoingPaperOriginal(
  database: Pick<
    PrismaClient,
    "invoice" | "externalBillingDocument" | "auditLog" | "$transaction"
  >,
  input: {
    origin: "OWN" | "EXTERNAL";
    id: string;
    marked: boolean;
    userId: string;
    now?: Date;
  },
): Promise<{ changed: boolean }> {
  return database.$transaction(async (tx) => {
    const paperOriginalAt = input.marked ? (input.now ?? new Date()) : null;
    let documentNumber: string | null;
    if (input.origin === "OWN") {
      const row = await tx.invoice.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          direction: true,
          status: true,
          invoiceNumber: true,
          paperOriginalAt: true,
        },
      });
      if (!row || row.direction !== "OUTBOUND")
        throw new OutgoingDocumentNotFoundError();
      if (row.status !== "ISSUED") throw new OutgoingDocumentNotIssuedError();
      if ((row.paperOriginalAt !== null) === input.marked)
        return { changed: false };
      await tx.invoice.update({
        where: { id: row.id },
        data: { paperOriginalAt },
      });
      documentNumber = row.invoiceNumber;
    } else {
      const row = await tx.externalBillingDocument.findUnique({
        where: { id: input.id },
        select: { id: true, documentNumber: true, paperOriginalAt: true },
      });
      if (!row) throw new OutgoingDocumentNotFoundError();
      if ((row.paperOriginalAt !== null) === input.marked)
        return { changed: false };
      await tx.externalBillingDocument.update({
        where: { id: row.id },
        data: { paperOriginalAt },
      });
      documentNumber = row.documentNumber;
    }
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.marked
          ? "billing.outgoing-paper-original.set"
          : "billing.outgoing-paper-original.cleared",
        entityType:
          input.origin === "OWN" ? "Invoice" : "ExternalBillingDocument",
        entityId: input.id,
        metadata: { documentNumber },
      },
    });
    return { changed: true };
  });
}
