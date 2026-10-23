import type { PrismaClient } from "@acropora/database";
import type { IncomingRelatedDocument } from "@acropora/types";

/**
 * A SZÁMLÁVAL EGY VÁRHATÓ BEÉRKEZÉSEN ÁLLÓ TÖBBI DOKUMENTUM (acrobot 35579,
 * Balázs: a díjbekérő legyen párosítva az előleg- és végszámlával).
 *
 * A külföldi (postafiókos) szállító díjbekérőjét és számláját a Várható
 * beérkezések a szállító RENDELÉSSZÁMA szerint köti egy beérkezésre
 * (`expected-arrival.intake.ts`). A bejövő számlák adatlapja eddig nem mutatta
 * ezt a kapcsolatot. Itt az adatlap sorának forrás-dokumentumából indulunk, és
 * a vele egy beérkezésen álló többi dokumentumot adjuk vissza.
 *
 * Csak olvas, a fájl tartalmát soha nem olvassa. A Számlázz.hu feed sorának
 * forrás-dokumentuma nem áll beérkezésen, ott üres a lista: a feed
 * díjbekérő/előleg/végszámla kapcsolata ma nem létezik (nincs ilyen feed-sor).
 */

type Database = Pick<PrismaClient, "incomingSupplierDocument">;

export interface RelatedSource {
  id: string;
  kind: string | null;
  fileName: string;
  status: string;
  receivedAt: Date | null;
  createdAt: Date;
  importResult: unknown;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function toRelatedDocument(row: RelatedSource): IncomingRelatedDocument {
  const result =
    row.importResult && typeof row.importResult === "object"
      ? (row.importResult as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    kind: row.kind === "PROFORMA" || row.kind === "INVOICE" ? row.kind : null,
    fileName: row.fileName,
    invoiceNumber: text(result.invoiceNumber),
    orderReference: text(result.orderReference),
    receivedAt: (row.receivedAt ?? row.createdAt).toISOString(),
    status: row.status,
  };
}

export async function loadRelatedDocuments(
  database: Database,
  sourceDocumentId: string | null,
): Promise<IncomingRelatedDocument[]> {
  if (!sourceDocumentId) return [];
  const own = await database.incomingSupplierDocument.findUnique({
    where: { id: sourceDocumentId },
    select: { expectedArrivalId: true },
  });
  if (!own?.expectedArrivalId) return [];
  const others = await database.incomingSupplierDocument.findMany({
    where: {
      expectedArrivalId: own.expectedArrivalId,
      id: { not: sourceDocumentId },
      // a döntésre váró (SUGGESTED, UNASSIGNED) vagy más okból félretett gyűjtött
      // dokumentum nem része a kapcsolatnak, akkor sem, ha egyszer egy beérkezésre
      // kerülne (barracuda #1831: ma csak az írási utak miatt nem kerülhet ide)
      reviewState: null,
    },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      kind: true,
      fileName: true,
      status: true,
      receivedAt: true,
      createdAt: true,
      importResult: true,
    },
  });
  return others.map(toRelatedDocument);
}
