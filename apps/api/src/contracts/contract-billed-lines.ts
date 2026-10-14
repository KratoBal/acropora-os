import type { ContractBilledLine } from "@acropora/types";
import type { Prisma, PrismaClient } from "@acropora/database";

/**
 * MI SZÁMÍT SZÁMLÁZOTTNAK EGY BESZERZÉSI SZERZŐDÉS TÉTELÉBŐL (feladat d510).
 * Egy helyen, mert a szerződésoldal (mennyi van számlázva, mennyi maradt) és a
 * kiállítás (csak a maradék mehet) ugyanazt kell, hogy számolja.
 *
 *   - a sor a szerződés tételére mutat (`InvoiceLine.contractItemId`), tétel-sor
 *     (a kedvezmény-sor nem mennyiség);
 *   - kimenő SZÁMLA vagy VÉGSZÁMLA: a díjbekérő nem számla, az előleg pedig
 *     ugyanazokat a tételeket hordja, mint a később kiállított végszámla --
 *     mindkettőt számolva egy tétel kétszer fogyna;
 *   - KIÁLLÍTOTT vagy KIÁLLÍTÁS ALATT ÁLLÓ: a vázlat még nem számla; az ISSUING
 *     már foglal, különben két párhuzamos kiállítás együtt túlszámlázhatna;
 *   - nincs KIÁLLÍTOTT sztornója: a sztornó visszaadja a mennyiséget. Egy
 *     folyamatban lévő sztornó még nem: amíg nem kész, a számla áll.
 *
 * `excludeInvoiceId`: a kiállítás a saját sorait nem számolja a „máshol
 * számlázott" közé.
 */
export const CONTRACT_BILLED_DOCUMENT_TYPES = [
  "INVOICE",
  "FINAL_INVOICE",
] as const;
export const CONTRACT_BILLED_STATUSES = ["ISSUED", "ISSUING"] as const;

type Db =
  | Pick<PrismaClient, "invoiceLine">
  | Pick<Prisma.TransactionClient, "invoiceLine">;

export async function contractBilledLines(
  db: Db,
  contractId: string,
  excludeInvoiceId?: string,
): Promise<ContractBilledLine[]> {
  const rows = await db.invoiceLine.findMany({
    where: {
      kind: "ITEM",
      contractItem: { contractId },
      invoice: {
        ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
        direction: "OUTBOUND",
        documentType: { in: [...CONTRACT_BILLED_DOCUMENT_TYPES] },
        status: { in: [...CONTRACT_BILLED_STATUSES] },
        correctionInvoices: {
          none: { documentType: "STORNO", status: "ISSUED" },
        },
      },
    },
    select: { contractItemId: true, quantity: true },
  });
  return rows.flatMap((row) =>
    row.contractItemId
      ? [
          {
            contractItemId: row.contractItemId,
            quantity: row.quantity.toString(),
          },
        ]
      : [],
  );
}
