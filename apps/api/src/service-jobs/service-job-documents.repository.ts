import { Injectable } from "@nestjs/common";

import { prisma, type Prisma } from "@acropora/database";
import type { ServiceJobDocumentSummary } from "@acropora/types";

import { documentedContentType } from "../service-assets/service-assets.repository.js";

/**
 * A TORLES NAPLO-CIMKEJE, EGY HELYEN.
 *
 * KET oldal hasznalja: az IRAS (ez a fajl) es az OLVASAS (a reszletlap
 * lekerdezese). Ha ket helyen allna, egy elgepeles NEM hibazna -- a torles
 * beirodna, a naplo pedig sosem talalna meg --, es a hiany pontosan ugy nezne
 * ki, mintha soha senki nem torolt volna semmit.
 */
export const DOCUMENT_DELETED_ACTION = "service_job.document.deleted";

/**
 * A SOR -> VALASZ LEKEPEZES, EGY HELYEN.
 *
 * KET MEZO NEM MEHET AT NYERSEN, es mindketto MAS okbol:
 *
 *   createdAt    a tablaban `Date`, a valaszban ISO szoveg. A JSON amugy is
 *                szoveggé alakitana, csak akkor a TIPUS hazudna rola.
 *   contentType  a tablaban `string`, a szerzodesben HAROM ertek uniója. A
 *                szukites nem kozmetika: az `AssetDocumentSummary` egykor
 *                rogzitett literalt mondott, es a kepek befogadasa utan
 *                CSENDBEN hazudott, mert a beiras oldalan `string` all.
 *
 * A `documentedContentType` AZ ESZKOZ-REPOSITORYBOL JON, es nem masolat: a
 * szabaly UGYANAZ (amit a feltolto tenylegesen ismer, `canonicalMimetypeFor`),
 * es egy masodik peldany egyszer szetcsuszna. A HELYE vitathato -- a
 * `documents/` mappa kozelebb allna --, de az athelyezes az eszkoz-utat is
 * mozditana, tehat kulon dontes.
 */
function toSummary(sor: {
  id: string;
  type: ServiceJobDocumentSummary["type"];
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  caption: string | null;
  createdAt: Date;
}): ServiceJobDocumentSummary {
  return {
    id: sor.id,
    type: sor.type,
    fileName: sor.fileName,
    contentType: documentedContentType(sor.contentType),
    sizeBytes: sor.sizeBytes,
    sha256: sor.sha256,
    caption: sor.caption,
    createdAt: sor.createdAt.toISOString(),
  };
}

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
    caption: string | null;
    actorUserId: string;
  }): Promise<ServiceJobDocumentSummary> {
    return this.database.serviceJobDocument
      .create({
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
          caption: input.caption,
          uploadedById: input.actorUserId,
        },
        select: {
          id: true,
          type: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          caption: true,
          createdAt: true,
        },
      })
      .then(toSummary);
  }

  /** Egy jegy csatolmanyai, TARTALOM NELKUL: a lista nem tolt le bajtokat. */
  async documents(serviceJobId: string): Promise<ServiceJobDocumentSummary[]> {
    return this.database.serviceJobDocument
      .findMany({
        where: { serviceJobId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          caption: true,
          createdAt: true,
        },
      })
      .then((sorok) => sorok.map(toSummary));
  }

  /**
   * A FELIRAT ATIRASA -- ES A JEGY AZONOSITOJA IS FELTETEL.
   *
   * `updateMany` es nem `update`, ugyanabbol az okbol, amiert a torles is
   * `deleteMany`: igy a jegy azonositoja a feltetel resze lehet. Egy
   * `update({ where: { id } })` egy MASIK jegy csatolmanyat is atirna, ha
   * valaki a sajat jegyenek utjara ir egy idegen dokumentum-azonositot.
   *
   * A VISSZATERES A TALALATOK SZAMA, nem a sor: a hivo ebbol tudja
   * megkulonboztetni a "nincs ilyen csatolmany" esetet a sikertol. Egy
   * `updateMany`, ami nulla sort erint, NEM hibazik -- es a hiba nema lenne: a
   * felulet a sajat begepelt szoveget mutatna tovabb, mintha mentve lenne.
   */
  async setCaption(
    serviceJobId: string,
    documentId: string,
    caption: string | null,
  ): Promise<number> {
    const result = await this.database.serviceJobDocument.updateMany({
      where: { id: documentId, serviceJobId },
      data: { caption },
    });
    return result.count;
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
  async deleteDocument(
    serviceJobId: string,
    documentId: string,
    actorUserId: string | null,
  ) {
    return this.database.$transaction(async (transaction) => {
      const document = await transaction.serviceJobDocument.findFirst({
        where: { id: documentId, serviceJobId },
        select: {
          id: true,
          fileName: true,
          type: true,
          storageKey: true,
          /**
           * A FELTOLTES ADATAI IS -- MERT EZ A SOR VISZI OKET.
           *
           * A feltoltes MA IS naplozva van, csak nem a naploban: a csatolmany
           * sora hordozza, KI toltotte fel es MIKOR. Ha a sort toroljuk, ez a
           * nyom is eltunik vele. Ezert veszi at a torles-bejegyzes -- kulonben
           * egy torles KET dolgot semmisitene meg, nem egyet.
           */
          createdAt: true,
          uploadedBy: { select: { displayName: true } },
        },
      });
      if (!document) return null;
      await transaction.serviceJobDocument.deleteMany({
        where: { id: documentId, serviceJobId },
      });
      /**
       * A FELTOLTESNEK NINCS SAJAT SORA, MERT AMIG A FAJL FENT VAN, LATSZIK A
       * LISTAN -- AMIKOR PEDIG ELTUNIK, A TORLES SORA VISZI MAGAVAL, AMIT ROLA
       * TUDNI KELL.
       *
       * ES A KET FELE KOZOTT EPP AZ A PILLANAT VAN, AMIERT A NAPLO LETEZIK. A
       * "van sajat nyoma" pontosan abban az egy esetben hamis, amikor valaki a
       * naplot OLVASSA: a fajl akkor mar nincs a listan, tehat a lista epp azt
       * nem mutatja, amirol a kerdes szol.
       *
       * Ha a sor csak annyit mondana, hogy "X torolt egy fajlt", a ket
       * kerdes, amit ilyenkor feltesznek -- MENNYI IDEIG volt fent, es KI tette
       * fel --, megvalaszolatlan maradna. Ezert veszi at a bejegyzes a torolt
       * sor tartalmat.
       *
       * EZ AZ UTOLSO PILLANAT, AMIKOR EZ AZ ADAT LETEZIK. Az `uploadedById` es a
       * `createdAt` a torles utan MEGSZUNIK -- ami csak a valtozas ELOTT all
       * fenn, azt a valtozas idejen kell rogziteni, vagy soha.
       *
       * ES EGY SOR, NEM KETTO: egy kulon feltoltes-naplo megketszerezne a
       * forgalmat azert, hogy osszeparositva ugyanezt mondja -- a parositas
       * pedig elromolhat, egy sor viszont nem tud elcsuszni onmagatol.
       *
       * Aki ezt "befejezi" egy feltoltes-naploval, nem hianyt potol.
       *
       * A NYOM UGYANABBAN A TRANZAKCIOBAN KELETKEZIK, MINT A TORLES.
       *
       * Kulon hivasban ket rossz kimenet allna elo, es MIND A KETTO nemán: a
       * fajl eltunne naplo nelkul (epp az, amit ez a sor megelozni hivatott),
       * vagy a naplo allitana egy torlest, ami meg sem tortent. Egy
       * tranzakcioban a ketto egyutt all vagy egyutt bukik.
       *
       * AZ `entityId` A JEGY, NEM A DOKUMENTUM -- es ez a lenyeg, nem reszlet.
       * A dokumentum sora ezutan mar NINCS, tehat ra hivatkozva a naplot nem
       * lehetne visszakeresni. A jegyre hivatkozva viszont a meglevo
       * `@@index([entityType, entityId, createdAt])` epp ezt a lekerdezest
       * szolgalja ki: "mi tortent ezzel a jeggyel, idorendben".
       */
      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action: DOCUMENT_DELETED_ACTION,
          entityType: "ServiceJob",
          entityId: serviceJobId,
          metadata: {
            documentId: document.id,
            /**
             * A NEV ES A TIPUS MASOLATBAN. A dokumentum sora ezutan mar nincs
             * meg, tehat a naplo CSAK azt tudja, amit magaval visz.
             *
             * A TIPUS NEM UGYANAZ, MINT A KITERJESZTES: a `type` a mi
             * besorolasunk (fenykep vagy dokumentum), a fajlnev vege pedig
             * barmi lehet. Nev nelkul a naplo azt mondana, hogy "torles
             * tortent"; tipus nelkul azt, hogy egy FAJL tunt el -- de nem azt,
             * hogy a bizonyito fenykep-e vagy egy melleklet.
             *
             * A MERET ES A LENYOMAT SZANDEKOSAN KIMARAD. Azok egy MASIK
             * kerdesre valaszolnanak (ugyanaz a fajl kerult-e vissza), amit
             * senki nem tett fel, es egy megsemmisitett tartalom ujjlenyomatat
             * nem tartjuk meg anelkul, hogy kellene.
             */
            fileName: document.fileName,
            documentType: document.type,
            uploadedByName: document.uploadedBy?.displayName ?? null,
            uploadedAt: document.createdAt.toISOString(),
          } satisfies Prisma.JsonObject,
        },
      });
      return document;
    });
  }
}
