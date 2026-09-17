import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  ServiceJobDocumentSummary,
} from "@acropora/types";

import {
  discardStoredDocument,
  DocumentOverQuota,
  DocumentRejected,
  prepareDocument,
} from "../documents/document-intake.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { normalizeDocumentCaption } from "../documents/document-caption.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { ServiceJobDocumentsRepository } from "./service-job-documents.repository.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { serviceJobVisibilityFor } from "./service-job-visibility-scope.js";

/** A gazda neve a taroloban. EGY helyen all, mert negy hivas hasznalja. */
const OWNER = "service-job" as const;

/**
 * FENYKEP (VAGY EGYEB FAJL) A HIBAJEGYHEZ.
 *
 * Balazs kerese (2026-09-14 19:41, Discord, Szerviz ticketing szal, szo
 * szerint): „Ami meg kellene a foto feltoltesi lehetoseg. Hibajegy rogzitesekor
 * lehessen fotot illetve egyeb fajlokat is csatolni"
 *
 * === A FELTOLTES SZABALYAI NINCSENEK ITT ===
 *
 * Tartalom-felismeres, fajlnev-tisztitas, sha256, keret-ellenorzes es a
 * tarolo-visszaeses a kozos magban all (`documents/document-intake.ts`). Itt
 * KET dolog van, es pontosan az a ketto, amit a mag fejlece a hivora hagy:
 * a JOGOSULTSAG es a SOR IRASA.
 *
 * === A LATHATOSAG A JEGYE, NEM A CSATOLMANYE ===
 *
 * Mind a negy metodus ELSO lepese ugyanaz: megkeresi a jegyet a HIVO
 * hatokorevel, es ha nincs, 404. Egy dokumentum-vegpont, ami tagabb, mint a
 * jegy sajat lathatosaga, nem hibazik -- csendben elarulja, hogy a jegy
 * LETEZIK, es a szamabol egy partner vegigprobalhatna, mennyi jegyunk van.
 *
 * === A JEGY A MENTES PILLANATABAN MEG NEM LETEZIK ===
 *
 * A keres szo szerint „hibajegy rogzitesekor" csatolast mond, es a jegy akkor
 * meg nincs meg. Ez a modul SZANDEKOSAN nem old meg elore-feltoltest: a mobil
 * eszkoz-urlap ugyanerre a problemara mar bevalt sorrendet hasznal (a fajlt a
 * mentes ELOTT valasztjuk ki, es a rekord letrejotte UTAN toltjuk fel). A
 * sorrend a FELULETE; ide annyi tartozik, hogy egy MAR LETEZO jegyre lehessen
 * feltolteni. (acrobot kikotese, 2026-09-14.)
 */
@Injectable()
export class ServiceJobDocumentsService {
  private readonly logger = new Logger(ServiceJobDocumentsService.name);

  constructor(
    private readonly repository: ServiceJobDocumentsRepository,
    private readonly jobs: ServiceJobsRepository,
    /**
     * A DOKUMENTUM-TAROLO ELHAGYHATO, ugyanabbol az okbol, mint a masik ket
     * gazdanal: a meglevo tesztek tobb tucat helyen allitjak elo a
     * szolgaltatasokat, es egyik sem tolt fel fajlt. A feltoltesi ut viszont
     * KIMONDJA, ha hianyzik (503, sajat uzenettel), tehat nem nema.
     */
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  /**
   * A JEGY, A HIVO HATOKOREVEL -- VAGY 404.
   *
   * MINDEN METODUS ELSO SORA, es szandekosan EGY helyen: ha a negy vegpont
   * kulon-kulon dontene, harom helyes es egy tagabb valtozat is eloallhatna,
   * es a negyedik NEMAN szivarogna.
   */
  private async requireVisibleJob(id: string, user: AuthenticatedUser) {
    const visibility = await serviceJobVisibilityFor(user, (userId) =>
      this.jobs.assignedUnitIds(userId),
    );
    const found = await this.repository.visibleJobId(id, visibility);
    if (found === null)
      throw new NotFoundException("A hibajegy nem található.");
    return found;
  }

  /**
   * A VISSZATERESI TIPUS KI VAN IRVA, ES EZ NEM DISZITES.
   *
   * A felulet ugyanezt a tipust importalja a kozos csomagbol. Kiiras nelkul a
   * szerver alakja elmozdulhatna (egy atnevezett mezo MINDKET oldalon
   * lefordul), es a kepernyon `undefined` jelenne meg, hibauzenet nelkul.
   */
  async addDocument(
    id: string,
    type: "PHOTO" | "OTHER",
    file: Express.Multer.File,
    user: AuthenticatedUser,
    caption?: string | null,
  ): Promise<ServiceJobDocumentSummary> {
    await this.requireVisibleJob(id, user);
    // A HIANY EGYFELE ALAKBAN ALL, es a szabaly KOZOS a harom gazdan.
    const felirat = normalizeDocumentCaption(caption);

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );

    const documentId = randomUUID();
    let prepared;
    try {
      prepared = await prepareDocument(
        { owner: OWNER, ownerId: id, documentId, file },
        {
          store: this.documentStore,
          usedBytes: () => sumDocumentBytesInUse(),
          logger: this.logger,
        },
      );
    } catch (error) {
      // A KET ELUTASITAS KET KULONBOZO HTTP VALASZ: a rossz fajl a KULDO
      // hibaja (400), a betelt keret a rendszere (409).
      if (error instanceof DocumentRejected)
        throw new BadRequestException(error.message);
      if (error instanceof DocumentOverQuota)
        throw new ConflictException(error.message);
      throw error;
    }

    if (prepared.placement === "database")
      return this.repository.addDocument({
        ...prepared.common,
        serviceJobId: id,
        type,
        caption: felirat,
        actorUserId: user.id,
        content: prepared.content,
      });

    try {
      return await this.repository.addDocument({
        ...prepared.common,
        serviceJobId: id,
        type,
        caption: felirat,
        actorUserId: user.id,
        content: null,
        storageKey: prepared.storageKey,
      });
    } catch (error) {
      // A SOR NEM JOTT LETRE, TEHAT A FAJL SEM MARADHAT.
      await discardStoredDocument(
        { owner: OWNER, ownerId: id, documentId },
        { store: this.documentStore },
      );
      throw error;
    }
  }

  /**
   * A FELIRAT ATIRASA EGY MAR FELTOLTOTT CSATOLMANYON.
   *
   * MIERT KELL A FELTOLTESKORI MELLE: a bizonyitek gyakran elobb keszul el,
   * mint a magyarazata. A szerelo a helyszinen fenykepez -- gyakran kesztyuben,
   * egy kezzel --, es az iroda az, aki utolag megnevezi, mit latunk.
   * Feltoltes-kori felirat ONMAGABAN azt jelentene, hogy egy elgepeles vagy egy
   * kesobb megertett reszlet soha nem javithato.
   *
   * A JOGKOR A `SERVICE_MANAGE`, ugyanaz, mint a feltoltese es a torlese: a
   * felirat a jegy tartalma, nem megjegyzes a margon.
   */
  async setDocumentCaption(
    id: string,
    documentId: string,
    caption: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.requireVisibleJob(id, user);
    const erintett = await this.repository.setCaption(
      id,
      documentId,
      normalizeDocumentCaption(caption),
    );
    /**
     * A NULLA ERINTETT SOR NEM SIKER. Egy `updateMany`, ami semmit nem talalt,
     * NEM hibazik -- es a hiba nema lenne: a felulet a sajat begepelt szoveget
     * mutatna tovabb, mintha mentve lenne.
     */
    if (erintett === 0)
      throw new NotFoundException("A csatolmány nem található.");
    return { ok: true };
  }

  /** Egy jegy csatolmanyai, tartalom nelkul. */
  async documents(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ items: ServiceJobDocumentSummary[] }> {
    await this.requireVisibleJob(id, user);
    return { items: await this.repository.documents(id) };
  }

  /**
   * EGY CSATOLMANY BAJTJAI.
   *
   * A HAROM KUDARC KULON VALASZ, es ez mert tanulsagbol all igy: a masik ket
   * gazdanal 2026-09-09-ig mind a harom ugyanazt a 404-et adta, vagyis ugy
   * neztek ki, mintha a csatolmany nem letezne -- es aki azt latja, ADATOT fog
   * keresni, nem beallitast.
   */
  async documentBytes(id: string, documentId: string, user: AuthenticatedUser) {
    await this.requireVisibleJob(id, user);

    const document = await this.repository.document(id, documentId);
    if (!document) throw new NotFoundException("A csatolmány nem található.");

    if (document.content) return { ...document, bytes: document.content };

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );

    if (!document.storageKey)
      throw new ServiceUnavailableException(
        "A csatolmánynak nincs tartalma egyik forrásban sem.",
      );

    const key = { owner: OWNER, ownerId: id, documentId };
    // HA A SOR MAS ELRENDEZESSEL KESZULT, a helyes viselkedes a MEGALLAS, nem
    // az, hogy a mai elrendezes szerint keresunk egy fajlt, ami nincs ott.
    assertStorageKeyMatches(document.storageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new ServiceUnavailableException(
        "A csatolmány tartalma a tárolóban nem érhető el.",
      );
    return { ...document, bytes };
  }

  /**
   * A CSATOLMANY TORLESE -- ELOSZOR A SOR, AZUTAN A BAJTOK.
   *
   * A SORREND A FELTOLTES FORDITOTTJA, es ugyanabbol az okbol. Feltoltesnel
   * eloszor a bajtok mennek, hogy egy elhasalt iras legfeljebb ARVA FAJLT
   * hagyjon, ne elveszett sort. Torlesnel ugyanez tukorben: ha a fajl menne
   * eloszor es a sor torlese bukna el, egy LATSZO csatolmany maradna, aminek a
   * letoltese hibat ad. Forditva legfeljebb egy arva fajl marad a lemezen --
   * szemet, nem adatvesztes --, es az egyeztetes (`store-reconciliation.cli`)
   * meg is talalja.
   *
   * A TAROLO-TORLES HIBAJAT ELNYELJUK, ugyanabbol az okbol, amiert a
   * `discardStoredDocument` is: a sor mar nincs meg, tehat a hivo szempontjabol
   * a muvelet SIKERULT. Egy kivetel itt azt sugallna, hogy a torles nem
   * tortent meg -- es a hivo ujraprobalna valamit, ami mar nincs.
   */
  async deleteDocument(
    id: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireVisibleJob(id, user);

    const removed = await this.repository.deleteDocument(
      id,
      documentId,
      user.id,
    );
    if (!removed) throw new NotFoundException("A csatolmány nem található.");

    if (removed.storageKey && this.documentStore)
      await discardStoredDocument(
        { owner: OWNER, ownerId: id, documentId },
        { store: this.documentStore },
      );

    return { removed: true };
  }
}
