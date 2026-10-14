import type { ContractBilledLine } from "@acropora/types";
import type { Prisma, PrismaClient } from "@acropora/database";

/**
 * MI SZÁMÍT SZÁMLÁZOTTNAK EGY BESZERZÉSI SZERZŐDÉS TÉTELÉBŐL (feladat d510).
 * Egy helyen, mert a szerződésoldal (mennyi van számlázva, mennyi maradt) és a
 * kiállítás (csak a maradék mehet) ugyanazt kell, hogy számolja.
 *
 *   - a sor a szerződés tételére mutat (`InvoiceLine.contractItemId`), tétel-sor
 *     (a kedvezmény-sor nem mennyiség);
 *   - kimenő SZÁMLA, VÉGSZÁMLA, vagy ELŐLEG, amíg nincs élő végszámlája: a
 *     végszámla az előleg tételeit hordja, tehát a kettőből egyszerre csak az
 *     egyik számít. Az előleg addig, amíg a végszámlája nincs kiállítva (vagy
 *     kiállítás alatt), utána a végszámla helyette. Az előleget kihagyni a
 *     végszámláig RÉST nyitna (barracuda, #1699): közben egy rendes számla az
 *     egész tételre kiállítható lenne, és a végszámla utána beragadna. A
 *     díjbekérő nem számla;
 *   - KIÁLLÍTOTT vagy KIÁLLÍTÁS ALATT ÁLLÓ: a vázlat még nem számla; az ISSUING
 *     már foglal, különben két párhuzamos kiállítás együtt túlszámlázhatna;
 *   - nincs KIÁLLÍTOTT sztornója: a sztornó visszaadja a mennyiséget. Egy
 *     folyamatban lévő sztornó még nem: amíg nem kész, a számla áll. Egy
 *     sztornózott végszámla után az előleg újra számít.
 *
 * `excludeInvoiceIds`: a kiállítás a saját sorait nem számolja a „máshol
 * számlázott" közé, és a végszámla a saját előlegéét sem (különben önmagával
 * ütközne).
 */
export const CONTRACT_BILLED_STATUSES = ["ISSUED", "ISSUING"] as const;
/** A bizonylattípusok, amiket a kiállítás őre a szerződés maradékához mér. */
export const CONTRACT_GUARDED_DOCUMENT_TYPES = [
  "INVOICE",
  "ADVANCE_INVOICE",
  "FINAL_INVOICE",
] as const;

const NOT_STORNOED = {
  correctionInvoices: { none: { documentType: "STORNO", status: "ISSUED" } },
} as const;

/** A számlázottnak számító kimenő bizonylatok szűrője (a sorokon az `invoice` alatt). */
export const contractBilledInvoiceWhere = {
  direction: "OUTBOUND",
  status: { in: [...CONTRACT_BILLED_STATUSES] },
  AND: [
    NOT_STORNOED,
    {
      OR: [
        { documentType: { in: ["INVOICE", "FINAL_INVOICE"] } },
        {
          documentType: "ADVANCE_INVOICE",
          // nincs élő végszámlája: kiállított vagy kiállítás alatti, nem sztornózott
          correctionInvoices: {
            none: {
              documentType: "FINAL_INVOICE",
              status: { in: [...CONTRACT_BILLED_STATUSES] },
              ...NOT_STORNOED,
            },
          },
        },
      ],
    },
  ],
} satisfies Prisma.InvoiceWhereInput;

/**
 * Ugyanez a szabály egy betöltött bizonylatra (a CLI tervéhez): a `finals` az
 * előleg végszámlái, a `stornoed` hogy van-e kiállított sztornója.
 */
export function invoiceCountsAsContractBilled(invoice: {
  direction: string;
  documentType: string;
  status: string;
  stornoed: boolean;
  finals?: ReadonlyArray<{ status: string; stornoed: boolean }>;
}): boolean {
  const live = (status: string) =>
    (CONTRACT_BILLED_STATUSES as readonly string[]).includes(status);
  if (
    invoice.direction !== "OUTBOUND" ||
    !live(invoice.status) ||
    invoice.stornoed
  )
    return false;
  if (
    invoice.documentType === "INVOICE" ||
    invoice.documentType === "FINAL_INVOICE"
  )
    return true;
  if (invoice.documentType === "ADVANCE_INVOICE")
    return !(invoice.finals ?? []).some((f) => live(f.status) && !f.stornoed);
  return false;
}

type Db =
  | Pick<PrismaClient, "invoiceLine">
  | Pick<Prisma.TransactionClient, "invoiceLine">;

export async function contractBilledLines(
  db: Db,
  contractId: string,
  excludeInvoiceIds: readonly string[] = [],
): Promise<ContractBilledLine[]> {
  const rows = await db.invoiceLine.findMany({
    where: {
      kind: "ITEM",
      contractItem: { contractId },
      invoice: {
        ...(excludeInvoiceIds.length
          ? { id: { notIn: [...excludeInvoiceIds] } }
          : {}),
        ...contractBilledInvoiceWhere,
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
