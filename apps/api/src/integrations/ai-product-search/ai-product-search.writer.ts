import { Injectable } from "@nestjs/common";

import { Repository, prisma } from "@acropora/database";
import {
  buildDocument,
  type DocumentSourceProduct,
} from "./ai-product-search.document.js";

/**
 * A KERESESI DOKUMENTUM EGYETLEN IROJA - ES EZERT NEM KET MECHANIZMUS.
 *
 * Harom helyrol hivjuk: a UNAS szinkronbol, a helyi termek-irasbol, es a
 * feltoltesbol. Mindharom UGYANEZT a fuggvenyt hivja, mert harom recept harom
 * iranyba sodrodna, es a sodrodas lathatatlan: az index az egyik szoveget
 * tokenizalna, a feltoltes a masikat.
 *
 * A `client` azert parameter, es nem a sajat kapcsolatunk: a ket iro egy MAR
 * NYITOTT tranzakcion belul hiv, es a dokumentumnak ugyanabban a tranzakcioban
 * kell keszulnie, mint a termeknek. Kulon kapcsolattal a ketto szetcsuszhatna,
 * es a kereses egy olyan allapotot latna, ami sosem letezett.
 */
export const AI_SEARCH_DOCUMENT_SELECT = {
  id: true,
  name: true,
  isActive: true,
  mirrorState: true,
  catalogAuthority: true,
  description: true,
  brand: { select: { name: true } },
  categories: { select: { category: { select: { name: true } } } },
  variants: {
    select: {
      sku: true,
      manufacturerPartNumber: true,
      barcodes: { select: { code: true } },
      supplierProducts: { select: { supplierSku: true } },
    },
    where: { isActive: true },
  },
  unasSnapshot: {
    select: {
      descriptionShort: true,
      descriptionLong: true,
      parameters: true,
    },
  },
} as const;

/**
 * Amit egy tranzakcio-kliensbol hasznalunk. Szandekosan szuk: pontosan ket
 * muvelet, es egyik sem ir termeket. A ket hivo (a UNAS szinkron es a helyi
 * termek-iras) sajat, szuk tranzakcio-felulettel dolgozik, es ez a felulet
 * azert ilyen kicsi, hogy beleferjen anelkul, hogy barmelyiket kinyitna.
 */
export interface DocumentWriterClient {
  product: {
    findUnique(args: unknown): Promise<unknown>;
  };
  aiProductSearchDocument: {
    upsert(args: unknown): Promise<unknown>;
  };
}

/**
 * Egy termek dokumentuma, a hivo tranzakciojaban.
 *
 * Ha a termek nem talalhato, NEM ir es NEM dob: a hivo tranzakcioja fontosabb,
 * mint az index frissessege. Egy hianyzo dokumentum-sor a megtalalhatosagot
 * kesleteti; egy visszagorgetett termek-iras adatot veszit.
 */
export async function writeSearchDocument(
  client: DocumentWriterClient,
  productId: string,
): Promise<boolean> {
  const product = (await client.product.findUnique({
    where: { id: productId },
    select: AI_SEARCH_DOCUMENT_SELECT,
  })) as DocumentSourceProduct | null;

  if (!product) return false;

  const document = buildDocument(product);

  await client.aiProductSearchDocument.upsert({
    where: { productId },
    create: document,
    update: document,
  });

  return true;
}

/**
 * A feltoltes ES az ujraepites - ugyanaz a kod, ket alkalommal hivva.
 *
 * A ket esemeny-iro (szinkron, helyi iras) csak akkor fut, ha egy termek
 * MEGVALTOZIK. Egy honapok ota valtozatlan termek soha nem kapna sort, es a
 * kereses a katalogus toredeket latna - ugy, hogy kozben minden zold. Ez a
 * fuggveny az, ami ezt megszunteti, es ugyanez kell akkor is, ha a recept vagy
 * a szotar valtozik.
 *
 * KOTEGELVE, SORONKENTI TRANZAKCIOBAN: egy nagy tranzakcio a teljes tablat
 * zarolna, es a kereses kozben allna. Igy a tabla menet kozben vegyes verzioju,
 * es ezt a valasz ki is mondja.
 */
@Injectable()
export class AiProductSearchWriter extends Repository {
  constructor() {
    super(prisma);
  }

  async rebuildAll(batchSize = 200): Promise<{ written: number }> {
    let written = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.database.product.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const product of batch) {
        const ok = await writeSearchDocument(
          this.database as unknown as DocumentWriterClient,
          product.id,
        );

        if (ok) written += 1;
      }

      cursor = batch[batch.length - 1]?.id;
    }

    return { written };
  }

  /**
   * AZ EGYENSULY-ELLENORZES, ES MINDKET SZAMOT KIIRJA.
   *
   * Nem a kulonbseget adja vissza, hanem a ket oldalt: ha egyszer eltolodik,
   * tudni akarjuk, MELYIK oldal mozdult. A ket szamnak egyeznie KELL - nincs
   * olyan eset, amiben szandekosan elter, mert a torolt es az inaktiv termek is
   * kap sort, csak `isSearchable = false` ertekkel. Az egyenlotlenseg tehat
   * MINDIG hiba, es nem ertelmezes kerdese.
   */
  async balance(): Promise<{
    searchableProducts: number;
    searchableDocuments: number;
    totalProducts: number;
    totalDocuments: number;
  }> {
    const [
      searchableProducts,
      searchableDocuments,
      totalProducts,
      totalDocuments,
    ] = await Promise.all([
      this.database.product.count({
        /**
         * UGYANAZ A FELTETEL, MINT A RECEPTBEN (`buildDocument`), es a NULL-t
         * kiirva kezeli: a `not` onmagaban SQL-ben a NULL sorokat is kizarna,
         * es epp azok a helyben letrehozott termekek.
         */
        where: {
          isActive: true,
          OR: [{ mirrorState: null }, { mirrorState: { not: "MISSING" } }],
        },
      }),
      this.database.aiProductSearchDocument.count({
        where: { isSearchable: true },
      }),
      this.database.product.count(),
      this.database.aiProductSearchDocument.count(),
    ]);

    return {
      searchableProducts,
      searchableDocuments,
      totalProducts,
      totalDocuments,
    };
  }
}
