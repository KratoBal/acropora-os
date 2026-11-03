import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  billingDocumentPath,
  formatMoney,
  incomingDocumentPath,
  type SearchResultItem,
} from "@acropora/types";

import { BillingDocumentListRepository } from "./billing-document-list.repository.js";

/**
 * A SZÁMLÁK A GLOBÁLIS KERESŐBEN (T2.2, 1. szelet): a kimenő és külső bizonylatok (a
 * `billing/documents` lista keresője) és a bejövő számlák együtt, egy csoportban, a legfrissebb
 * kiállítás szerint. A hívó (`SearchService`) CSAK `billing.view`-val rendelkezőnek hívja: ugyanez a
 * jog védi mindkét listát. Itt nincs jogosultság-ellenőrzés, tehát ezt a szolgáltatást nem szabad
 * máshonnan, a csoport kapuja nélkül hívni.
 *
 * A BEJÖVŐ OLDAL A TÁBLA SORAIT KERESI (számlaszám, szállító neve, adószám, rendelésszám). A
 * jóváhagyásra váró postafiókos PDF-ek nem találatok: azok az Ellenőrzés listán vannak, és nincs
 * tárolt sorukban szám vagy szállító (T2.2 1. szelet, kimondott határ).
 */
const LIMIT = 5;

interface Candidate {
  /** `YYYY-MM-DD`, a rendezéshez; hiányzó (vázlat) a végére kerül */
  day: string;
  item: SearchResultItem;
}

@Injectable()
export class InvoiceSearchService {
  private readonly database = prisma;

  constructor(private readonly documents: BillingDocumentListRepository) {}

  async search(q: string): Promise<SearchResultItem[]> {
    const [outgoing, incoming] = await Promise.all([
      this.documents.list({ q, page: 1, pageSize: LIMIT }),
      this.database.incomingBillingDocument.findMany({
        where: {
          OR: [
            { documentNumber: { contains: q, mode: "insensitive" } },
            { supplierName: { contains: q, mode: "insensitive" } },
            { supplierTaxNumber: { contains: q } },
            { orderNumber: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: [{ issueDate: "desc" }, { id: "desc" }],
        take: LIMIT,
        select: {
          id: true,
          documentNumber: true,
          supplierName: true,
          grossAmount: true,
          currency: true,
          issueDate: true,
        },
      }),
    ]);

    const candidates: Candidate[] = [
      ...outgoing.items.map((doc) => ({
        day: doc.issueDate ?? "",
        item: {
          id: `document:${doc.id}`,
          title: doc.documentNumber ?? "Vázlat",
          subtitle: [
            doc.origin === "EXTERNAL" ? "Külső számla" : "Kimenő számla",
            doc.customerName,
            formatMoney(doc.grossAmount, doc.currency),
          ]
            .filter(Boolean)
            .join(" · "),
          path: billingDocumentPath(doc),
        },
      })),
      ...incoming.map((doc) => ({
        day: doc.issueDate.toISOString().slice(0, 10),
        item: {
          id: `incoming:${doc.id}`,
          title: doc.documentNumber,
          subtitle: [
            "Bejövő számla",
            doc.supplierName,
            formatMoney(doc.grossAmount.toString(), doc.currency),
          ]
            .filter(Boolean)
            .join(" · "),
          path: incomingDocumentPath(doc.id),
        },
      })),
    ];
    return mergeNewestFirst(candidates).slice(0, LIMIT);
  }
}

/** Legfrissebb elöl; egyenlő napnál a bejárási sorrend marad (stabil). */
export function mergeNewestFirst(
  candidates: readonly Candidate[],
): SearchResultItem[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) =>
      a.candidate.day === b.candidate.day
        ? a.index - b.index
        : a.candidate.day < b.candidate.day
          ? 1
          : -1,
    )
    .map(({ candidate }) => candidate.item);
}
