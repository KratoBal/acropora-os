import { Injectable } from "@nestjs/common";

import { prisma, type Prisma } from "@acropora/database";

/**
 * A HIBAJEGY CSATOLMANYAINAK SORAI.
 *
 * KULON REPOSITORY, ES NEM A `ServiceJobsRepository` BOVITESE. Ket oka van, es
 * egyik sem kenyelem:
 *
 * 1. A CSATOLMANY MAS ELETU, MINT A JEGY. A jegy sorat a lista, a reszletlap es
 *    az allapotgep olvassa; ezek a metodusok bajtokat mozgatnak. Egy tablaban
 *    tartva minden jovobeli olvaso azon a fajlon menne at, ahol a `content`
 *    mezot kell KIHAGYNI a `select`-bol -- es az elfelejtese NEMA: a lista
 *    lefut, csak epp megabajtokat hoz.
 * 2. A JEGY-REPOSITORY MA IS NYITOTT MUNKA ALATT ALL. Egy uj metodus ott
 *    utkozest szulne, ertek nelkul.
 */
@Injectable()
export class ServiceJobDocumentsRepository {
  private readonly database = prisma;

  /**
   * LATJA-E A HIVO EZT A JEGYET -- EGY OSZLOPPAL.
   *
   * A reszletlap ugyanezt a szurot hasznalja, de VISSZAAD MINDENT (naplo,
   * munkalapok, eszkozok). Egy csatolmany-feltoltes N fajlnal N-szer futtatna
   * azt a lekerdezest, holott egyetlen kerdesre kell valasz: letezik-e a jegy
   * A HIVO HATOKOREBEN.
   *
   * `findFirst` es nem `findUnique`: az utobbi csak egyedi kulcsra szur, tehat
   * a hatokort nem lehetne melle tenni. Ez ugyanaz az indok, amit a jegy
   * reszletlapja mar kimond.
   *
   * A `null` valasz KET dolgot jelent egyszerre (nincs ilyen jegy / nem latod),
   * es ez SZANDEKOS: egy kulon "nincs jogod" uzenet elarulna, hogy a jegy
   * letezik.
   */
  async visibleJobId(
    id: string,
    visibility: Prisma.ServiceJobWhereInput,
  ): Promise<string | null> {
    const row = await this.database.serviceJob.findFirst({
      where: { AND: [{ id }, visibility] },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * A CSATOLMANY SORA.
   *
   * A HIVO ADJA AZ AZONOSITOT, es ez nem stilus: a tarolo-kulcs ebbol all
   * ossze, tehat a bajtokat MEG A SOR ELOTT ki kell tudni irni. Ha az
   * azonosito csak a beszurasnal keletkezne, egy tarolo-hiba mar egy LETEZO,
   * tartalom nelkuli sort hagyna maga utan.
   */
  async addDocument(input: {
    id: string;
    serviceJobId: string;
    type: "PHOTO" | "OTHER";
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    content: Buffer | null;
    storageKey?: string | null;
    actorUserId: string;
  }) {
    return this.database.serviceJobDocument.create({
      data: {
        id: input.id,
        serviceJobId: input.serviceJobId,
        type: input.type,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        /**
         * A BAJTOK MASOLVA MENNEK BE, ugyanugy, mint a masik ket gazdanal: a
         * Prisma `Uint8Array`-t var, es a `Buffer` alosztaly -- a ket tipus nem
         * cserelheto fel szigoru ellenorzes mellett.
         */
        content: input.content ? Uint8Array.from(input.content) : null,
        storageKey: input.storageKey ?? null,
        uploadedById: input.actorUserId,
      },
      select: {
        id: true,
        type: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        createdAt: true,
      },
    });
  }

  /** Egy jegy csatolmanyai, TARTALOM NELKUL: a lista nem tolt le bajtokat. */
  async documents(serviceJobId: string) {
    return this.database.serviceJobDocument.findMany({
      where: { serviceJobId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        createdAt: true,
      },
    });
  }

  /** Egy csatolmany sora, a bajtokkal vagy a tarolo-kulccsal egyutt. */
  async document(serviceJobId: string, documentId: string) {
    return this.database.serviceJobDocument.findFirst({
      where: { id: documentId, serviceJobId },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        content: true,
        storageKey: true,
      },
    });
  }

  /**
   * A SOR TORLESE -- ES A TOROLT SOR VISSZAADASA.
   *
   * MIERT AD VISSZA VALAMIT: a bajtok a taroloban is allhatnak, es azokat a
   * HIVO torli. A `storageKey` nelkul nem tudna, kell-e egyaltalan.
   *
   * `deleteMany` es nem `delete`: igy a jegy azonositoja is a feltetel resze
   * lehet. Egy `delete({ where: { id } })` egy MASIK jegy csatolmanyat is
   * torolne, ha valaki a sajat jegyenek utjara irja egy idegen dokumentum
   * azonositojat.
   */
  async deleteDocument(serviceJobId: string, documentId: string) {
    return this.database.$transaction(async (transaction) => {
      const document = await transaction.serviceJobDocument.findFirst({
        where: { id: documentId, serviceJobId },
        select: { id: true, fileName: true, storageKey: true },
      });
      if (!document) return null;
      await transaction.serviceJobDocument.deleteMany({
        where: { id: documentId, serviceJobId },
      });
      return document;
    });
  }
}
