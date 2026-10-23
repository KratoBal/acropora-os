import {
  INVOICE_COLLECTION_ITEM_SOURCES,
  INVOICE_COLLECTION_ITEM_VERDICTS,
  type InvoiceCollectionItemRow,
  type InvoiceCollectionItemSource,
  type InvoiceCollectionItemVerdict,
  type InvoiceCollectionItemsResponse,
} from "@acropora/types";
import { BadRequestException, Injectable } from "@nestjs/common";

import {
  InvoiceCollectionItemsRepository,
  type CollectionItemRow,
} from "./invoice-collection-items.repository.js";

export const COLLECTION_ITEMS_DEFAULT_LIMIT = 200;
export const COLLECTION_ITEMS_MAX_LIMIT = 500;

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value))
    throw new BadRequestException(
      `A(z) ${name} értéke nem ismert: ${value.slice(0, 40)}.`,
    );
  return value as T;
}

export function parseLimit(value: string | undefined): number {
  if (value === undefined || value === "")
    return COLLECTION_ITEMS_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > COLLECTION_ITEMS_MAX_LIMIT
  )
    throw new BadRequestException(
      `A limit 1 és ${COLLECTION_ITEMS_MAX_LIMIT} közötti egész szám.`,
    );
  return parsed;
}

/** A tárolt fájlok ítéletei: ezek dokumentumként úgyis ott vannak a rendszerben. */
const STORED_VERDICTS: ReadonlySet<string> = new Set(["STORED", "SUGGESTED"]);

/**
 * A balazs@ postafiók (Balázs saját levelezése) NEM tárolt fájljairól a
 * fájlnév és a levélazonosító nem megy ki (barracuda #1827): a `finance.view`
 * jog nem Balázs magánlevelezésének a jele, és egy nem számla melléklet neve
 * (szerződés, ajánlat, emlékeztető) magánügyre is utalhat. Az ítélet, a forrás
 * és az idő kimegy, a darabszámok is. Az info@ és a Drive sorai teljesek. Egy
 * ismeretlen ítélet a visszatartott oldalon áll: a hiba iránya a titkosság.
 */
function withheld(row: CollectionItemRow): boolean {
  return row.source === "BALAZS_MAIL" && !STORED_VERDICTS.has(row.verdict);
}

function toRow(row: CollectionItemRow): InvoiceCollectionItemRow {
  const hide = withheld(row);
  return {
    id: row.id,
    source: row.source as InvoiceCollectionItemSource,
    externalId: hide ? null : row.externalId,
    fileName: hide ? null : row.fileName,
    verdict: row.verdict as InvoiceCollectionItemVerdict,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A GYŰJTŐ ÍTÉLETEI OLVASHATÓAN (acrobot 35522): Balázs maga lássa, mi lett egy
 * levél PDF-jéből, a `fleet_ro` jog nélkül. A szűrő az ítélet és a forrás; a
 * darabszámok a forrásra szólnak, az ítélet-szűrőtől függetlenül, hogy a
 * kapcsolók mutassák, mi van a többiben.
 */
@Injectable()
export class InvoiceCollectionItemsService {
  constructor(private readonly repository: InvoiceCollectionItemsRepository) {}

  async list(query: {
    verdict?: string;
    source?: string;
    limit?: string;
  }): Promise<InvoiceCollectionItemsResponse> {
    const verdict = oneOf(
      query.verdict,
      INVOICE_COLLECTION_ITEM_VERDICTS,
      "ítélet",
    );
    const source = oneOf(
      query.source,
      INVOICE_COLLECTION_ITEM_SOURCES,
      "forrás",
    );
    const limit = parseLimit(query.limit);
    // eggyel többet kérünk: ebből látszik, hogy a lista csonka
    const [rows, counts] = await Promise.all([
      this.repository.list({ verdict, source }, limit + 1),
      this.repository.counts(source),
    ]);
    const byVerdict = Object.fromEntries(
      INVOICE_COLLECTION_ITEM_VERDICTS.map((name) => [name, 0]),
    ) as Record<InvoiceCollectionItemVerdict, number>;
    for (const entry of counts)
      if (
        (INVOICE_COLLECTION_ITEM_VERDICTS as readonly string[]).includes(
          entry.verdict,
        )
      )
        byVerdict[entry.verdict as InvoiceCollectionItemVerdict] = entry.count;
    return {
      items: rows.slice(0, limit).map(toRow),
      counts: byVerdict,
      limit,
      truncated: rows.length > limit,
    };
  }
}
