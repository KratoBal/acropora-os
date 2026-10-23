import type { PrismaClient } from "@acropora/database";
import type {
  BillingDocumentStatus,
  BillingRelatedDocument,
} from "@acropora/types";

import { budapestDay } from "./billing-document-list.js";

/**
 * A KIMENŐ BIZONYLATOK LÁNCA (task kimeno-kapcsolodo-bizonylatok; Balázs
 * 2026-10-23 13:08-as kérése: díjbekérő, előleg, végszámla és sztornó egymáshoz
 * kötve látszódjon a számla oldalán).
 *
 * Két kapocs köt: `proformaInvoiceId` (a díjbekérő, amelyből a számla vagy az
 * előleg készült) és `referencedInvoiceId` (a végszámlán a levont előleg, a
 * sztornón az eredeti). A lánc a kiinduló bizonylatból mindkét irányban járt
 * ezeken a kapcsokon, amíg új tag nem kerül elő. A részletek egylépéses kapcsai
 * (`proforma`, `advance`, `deductedAdvance`, `finalInvoice`, `cancellation`)
 * maradnak; ez az egész láncot adja, minden tagján ugyanazt.
 *
 * A sztornó sor NEM `OWN_ROWS` (nincs forrás-hivatkozása), ezért a lekérdezés
 * csak a kimenő Számlázz.hu sorokra szűr, nem a saját-sor szabályra.
 */
const MAX_ROUNDS = 6;
const MAX_DOCUMENTS = 25;

/** A sorrend a lánc természetes sorrendje; a sztornó az érvénytelenített bizonylata mögé kerül. */
const TYPE_RANK: Record<string, number> = {
  PROFORMA: 0,
  ADVANCE_INVOICE: 1,
  INVOICE: 2,
  FINAL_INVOICE: 3,
  DELIVERY_NOTE: 4,
};
const CANCELLING = ["STORNO", "CORRECTION"];

interface ChainRow {
  id: string;
  documentType: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: Date | null;
  grossAmount: { toFixed(places: number): string } | null;
  currency: string;
  proformaInvoiceId: string | null;
  referencedInvoiceId: string | null;
  createdAt: Date;
}

export async function loadRelatedBillingDocuments(
  database: Pick<PrismaClient, "invoice">,
  startId: string,
): Promise<BillingRelatedDocument[]> {
  const known = new Map<string, ChainRow>();
  let wanted = new Set([startId]);
  for (let round = 0; round < MAX_ROUNDS && wanted.size > 0; round += 1) {
    const ids = [...wanted];
    const rows = (await database.invoice.findMany({
      where: {
        direction: "OUTBOUND",
        source: "SZAMLAZZ",
        OR: [
          { id: { in: ids } },
          { proformaInvoiceId: { in: [...known.keys(), ...ids] } },
          { referencedInvoiceId: { in: [...known.keys(), ...ids] } },
        ],
      },
      select: {
        id: true,
        documentType: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        grossAmount: true,
        currency: true,
        proformaInvoiceId: true,
        referencedInvoiceId: true,
        createdAt: true,
      },
      take: MAX_DOCUMENTS + 1,
    })) as ChainRow[];
    const next = new Set<string>();
    for (const row of rows) {
      if (!known.has(row.id)) next.add(row.id);
      known.set(row.id, row);
    }
    // the next round asks for the new rows (their children come with the OR)
    // and for the parents the new rows point at
    wanted = new Set(next);
    for (const id of next) {
      const row = known.get(id)!;
      for (const parent of [row.proformaInvoiceId, row.referencedInvoiceId])
        if (parent && !known.has(parent)) wanted.add(parent);
    }
    if (known.size > MAX_DOCUMENTS) break;
  }
  if (!known.has(startId) || known.size === 1) return [];

  const rows = [...known.values()];
  const when = (row: ChainRow) => (row.issueDate ?? row.createdAt).getTime();
  const base = rows
    .filter((row) => !CANCELLING.includes(row.documentType))
    .sort(
      (a, b) =>
        (TYPE_RANK[a.documentType] ?? 9) - (TYPE_RANK[b.documentType] ?? 9) ||
        when(a) - when(b) ||
        a.id.localeCompare(b.id),
    );
  const ordered: ChainRow[] = [];
  const cancellers = rows
    .filter((row) => CANCELLING.includes(row.documentType))
    .sort((a, b) => when(a) - when(b) || a.id.localeCompare(b.id));
  for (const row of base) {
    ordered.push(row);
    for (const canceller of cancellers)
      if (canceller.referencedInvoiceId === row.id) ordered.push(canceller);
  }
  // a canceller whose original is not in the chain still belongs to it
  for (const canceller of cancellers)
    if (!ordered.includes(canceller)) ordered.push(canceller);

  return ordered.slice(0, MAX_DOCUMENTS).map((row) => ({
    id: row.id,
    documentType: row.documentType as BillingRelatedDocument["documentType"],
    number: row.invoiceNumber,
    status: row.status as BillingDocumentStatus,
    issueDate: row.issueDate ? budapestDay(row.issueDate) : null,
    grossAmount: row.grossAmount ? row.grossAmount.toFixed(4) : null,
    currency: row.currency,
    current: row.id === startId,
    cancelsId: CANCELLING.includes(row.documentType)
      ? row.referencedInvoiceId
      : null,
  }));
}
