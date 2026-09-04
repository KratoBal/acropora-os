import {
  rowBelongsToScope,
  type PartnerScope,
} from "../auth/partner-scope.util.js";
import {
  canEditWorksheetEntry,
  describeEntryEditRefusal,
} from "./worksheet-entry-permission.js";
import { describeEmptySignerList } from "./worksheet-signer.js";
import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  discardStoredDocument,
  DocumentOverQuota,
  DocumentRejected,
  prepareDocument,
} from "../documents/document-intake.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type {
  WorksheetAttachableListResponse,
  WorksheetDetail,
  WorksheetVersionDiff,
} from "@acropora/types";

import type {
  AmendWorksheetDto,
  CreateWorksheetDepartmentDto,
  CreateWorksheetDto,
  CreateWorksheetLineDto,
  SetWorksheetAssigneesDto,
  SetWorksheetPartnerCodeDto,
  SignWorksheetVersionDto,
  UpdateWorksheetDraftDto,
  UpdateWorksheetLineDto,
  WorksheetContentDto,
  WorksheetLineDto,
  WorksheetListQueryDto,
} from "./dto/worksheet.dto.js";
import { mayWorksheetJoinTicket } from "../common/worksheet-under-ticket.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { normalizeAssigneeIds } from "./worksheet-assignment.js";
import {
  normalizeWorksheetContent,
  normalizeWorksheetLine,
  type NormalizedWorksheetContent,
  type NormalizedWorksheetLine,
} from "./worksheet-content.js";
import { diffWorksheetVersions } from "./worksheet-diff.js";
import {
  WORKSHEET_NUMBER_ISSUE_MESSAGES,
  type WorksheetNumberIssue,
} from "./worksheet-number.js";
import {
  WorksheetsRepository,
  type WorksheetCloseFailure,
} from "./worksheets.repository.js";
import type { WorksheetLineWriteResult } from "./worksheets.types.js";
import {
  toComparableVersion,
  toWorksheetDetail,
  type WorksheetDetailRow,
} from "./worksheets.types.js";

function isNumberIssue(reason: string): reason is WorksheetNumberIssue {
  return reason in WORKSHEET_NUMBER_ISSUE_MESSAGES;
}

function closeFailure(reason: WorksheetCloseFailure) {
  if (reason === "NOT_FOUND")
    return new NotFoundException("A munkalap nem található.");
  if (reason === "NOT_DRAFT")
    return new ConflictException("A munkalap már le van zárva.");
  if (reason === "NO_LINES")
    return new BadRequestException("Tétel nélküli munkalap nem zárható le.");
  if (reason === "LINE_PRICE_MISSING")
    return new BadRequestException(
      "Van olyan tétel, amin nincs ár. A lap lezárása előtt ezeket ki kell tölteni.",
    );
  if (isNumberIssue(reason))
    return new BadRequestException(WORKSHEET_NUMBER_ISSUE_MESSAGES[reason]);
  return new ConflictException("A munkalap lezárása nem sikerült.");
}

@Injectable()
export class WorksheetsService {
  /**
   * The notifier is optional so that every existing unit test - and any caller
   * that has no interest in phones - can build this service with the
   * repository alone. A worksheet is not worth less when nobody is notified,
   * and the assignment must not depend on it.
   */
  private readonly logger = new Logger(WorksheetsService.name);

  constructor(
    private readonly repository: WorksheetsRepository,
    @Optional() private readonly notifications?: NotificationsService,
    /**
     * A DOKUMENTUM-TAROLO ELHAGYHATO, es ez a meglevo tesztek miatt van igy:
     * a lap-tesztek tobb tucat helyen allitjak elo a szolgaltatast, es egyik
     * sem tolt fel fajlt. Ha kotelezo lenne, mindegyiket at kellene irni --
     * a feltoltesi ut viszont KIMONDJA, ha hianyzik, tehat nem nema.
     */
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  /**
   * FENYKEP (VAGY EGYEB FAJL) A MUNKALAPHOZ.
   *
   * === MIHEZ KOTODIK, ES MIERT NEM A VERZIOHOZ ===
   *
   * A kep BIZONYITEK a munkarol, nem a lap SZOVEGENEK resze. Egy alairt verzio
   * valtozatlan: ha a kep a verziohoz tartozna, egy kesobb erkezo fenykep vagy
   * nem ferne fel, vagy egy alairt rekordot irna at. ALAIRAS UTAN IS
   * felkerulhet -- a bizonyitek gyakran keson erkezik.
   *
   * A FELTOLTES SZABALYAI A KOZOS MAGBAN allnak, ugyanazok, mint az eszkoznel.
   */
  async addDocument(
    id: string,
    type: "PHOTO" | "OTHER",
    file: Express.Multer.File,
    actorUserId: string,
    scope: PartnerScope,
  ) {
    // A JOGOSULTSAG ITT DOL EL, nem a magban: a lap sajat hatokor-szabalya
    // vonatkozik ra, es azt egy kozos modul nem ismerheti.
    const lap = await this.repository.detail(id, scope);
    if (!lap) throw new NotFoundException("A munkalap nem található.");

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );

    const documentId = randomUUID();
    let prepared;
    try {
      prepared = await prepareDocument(
        { owner: "worksheet", ownerId: id, documentId, file },
        {
          store: this.documentStore,
          usedBytes: () => this.repository.documentBytesInUse(),
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
        worksheetId: id,
        type,
        actorUserId,
        content: prepared.content,
      });

    try {
      return await this.repository.addDocument({
        ...prepared.common,
        worksheetId: id,
        type,
        actorUserId,
        content: null,
        storageKey: prepared.storageKey,
      });
    } catch (error) {
      // A SOR NEM JOTT LETRE, TEHAT A FAJL SEM MARADHAT.
      await discardStoredDocument(
        { owner: "worksheet", ownerId: id, documentId },
        { store: this.documentStore },
      );
      throw error;
    }
  }

  /** Egy lap csatolmanyai, tartalom nelkul. */
  async documents(id: string, scope: PartnerScope) {
    const lap = await this.repository.detail(id, scope);
    if (!lap) throw new NotFoundException("A munkalap nem található.");
    return { items: await this.repository.documents(id) };
  }

  /**
   * EGY CSATOLMANY BAJTJAI.
   *
   * A KET FORRAS KULON AG, es a tarolo-kulcs EGYEZESET ellenorizzuk: ha a sor
   * mas elrendezessel keszult, a helyes viselkedes a MEGALLAS, nem az, hogy a
   * mai elrendezes szerint keresunk egy fajlt, ami nincs ott.
   */
  async documentBytes(id: string, documentId: string, scope: PartnerScope) {
    const lap = await this.repository.detail(id, scope);
    if (!lap) throw new NotFoundException("A munkalap nem található.");

    const document = await this.repository.document(id, documentId);
    if (!document) throw new NotFoundException("A csatolmány nem található.");

    if (document.content) return { ...document, bytes: document.content };

    if (!document.storageKey || !this.documentStore)
      throw new NotFoundException("A csatolmány tartalma nem érhető el.");

    const key = { owner: "worksheet" as const, ownerId: id, documentId };
    assertStorageKeyMatches(document.storageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new NotFoundException("A csatolmány tartalma nem érhető el.");
    return { ...document, bytes };
  }

  list(query: WorksheetListQueryDto, scope: PartnerScope) {
    return this.repository.list(query, scope);
  }

  /**
   * A FRISSEN IRT LAP VISSZAADASA, BELSOS HATOKORREL -- es azert kulon nev,
   * mert tiz irasi metodus vegen all ugyanez.
   *
   * Mindegyik SERVICE_MANAGE jog alatt fut, amit partner-oldali felhasznalo nem
   * kap meg, es mindegyik a SAJAT, epp irt lapjat adja vissza. A hatokort ki
   * kell mondani (a parameter kotelezo), de tiz azonos komment helyett egy nev
   * hordozza: aki ezt olvassa, egy helyen latja, MIERT nem szukitunk.
   *
   * HA VALAHA IRASI VEGPONT KERUL PARTNER-JOG ALA, ez az egy fuggveny a hely,
   * ahol at kell gondolni -- nem tiz hivasi hely.
   */
  private detailAfterWrite(id: string): Promise<WorksheetDetail> {
    return this.detail(id, { kind: "internal" });
  }

  async detail(id: string, scope: PartnerScope): Promise<WorksheetDetail> {
    return toWorksheetDetail(await this.requireWorksheet(id, scope));
  }

  async departments(customerId: string, scope: PartnerScope) {
    // AZ UTVONALBAN ALLO PARTNER EGYEZZEN A KEROEVEL. Itt nincs betoltott sor,
    // amin ellenorizni lehetne: maga az utvonal-parameter a tulajdonos. A nem
    // egyezo keres 404, nem 403 -- ugyanabbol az okbol, mint mashol.
    if (!rowBelongsToScope({ customerId }, scope)) {
      throw new NotFoundException("A partner nem található.");
    }
    await this.requireCustomer(customerId);
    return this.repository.departments(customerId);
  }

  async createDepartment(
    customerId: string,
    input: CreateWorksheetDepartmentDto,
  ) {
    await this.requireCustomer(customerId);
    try {
      return await this.repository.createDepartment(customerId, input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Ehhez a partnerhez már tartozik ilyen kódú alegység.",
        );
      }
      throw error;
    }
  }

  async setPartnerCode(customerId: string, input: SetWorksheetPartnerCodeDto) {
    await this.requireCustomer(customerId);
    const partnerCode = input.partnerCode.trim().toUpperCase();
    try {
      return await this.repository.setPartnerCode(customerId, partnerCode);
    } catch (error) {
      // Ugyanaz a két szabály, mint a partner képernyőn, ugyanazokkal a
      // mondatokkal: ez a végpont ugyanazt az oszlopot írja.
      if (
        error instanceof Error &&
        error.message === "PARTNER_CODE_USED_IN_NUMBERS"
      )
        throw new ConflictException(
          "Ezt a partnerkódot korábban már munkalapszám viselte, ezért nem adható ki újra. Válassz másikat.",
        );
      if (error instanceof Error && error.message === "PARTNER_CODE_LOCKED")
        throw new ConflictException(
          "Ehhez a partnerkódhoz már készült munkalapszám, ezért a kód nem módosítható és nem törölhető.",
        );
      // A név ÉS AZ OLDAL is utazik az üzenetben. "Ez a kód foglalt"
      // végigkerestetné a listát azzal, aki épp beírta; a puszta név pedig a
      // rossz képernyőre küldené, mert a partnerek és a vevők külön listák.
      const named = (prefix: string) =>
        error instanceof Error && error.message.startsWith(prefix)
          ? error.message.slice(prefix.length)
          : null;

      const takenByCustomer = named("PARTNER_CODE_TAKEN_BY_CUSTOMER:");
      if (takenByCustomer)
        throw new ConflictException(
          `Ezt a partnerkódot már viseli egy vevő: ${takenByCustomer}. Válassz másikat.`,
        );

      const takenBySupplier = named("PARTNER_CODE_TAKEN_BY_SUPPLIER:");
      if (takenBySupplier)
        throw new ConflictException(
          `Ezt a partnerkódot már viseli egy szállító partner: ${takenBySupplier}. Válassz másikat.`,
        );

      const mirrorOf = named("PARTNER_CODE_MIRROR_ROW:");
      if (mirrorOf)
        throw new ConflictException(
          `Ez a sor egy szerviz partner munkalapjait hordozza (${mirrorOf}), a kódja onnan származik. Állítsd be a partner adatlapján, a Partnerek menüben.`,
        );
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // AZ ADATBÁZIS EGYEDI INDEXE AZ UTOLSÓ FÉK, és a fentiek után ritkán
        // fut: a kód-ellenőrzések előbb kapják el az ütközést. Nem SOHA
        // viszont, mert két párhuzamos írás között ez marad az egyetlen.
        //
        // A mondat második fele korábban azt indokolta, hogy a szám
        // egyértelműen azonosítsa a partnert. Az indoklás a #182 óta NEM
        // ÁLL: a szám nem hordozza a rövidítést. A tiltás viszont áll, ezért
        // az indoklás ment ki, nem az ág. Egy ritkán futó ág hibás üzenete a
        // legrosszabb fajta: épp akkor vezet félre, amikor valaki először
        // találkozik vele.
        throw new ConflictException(
          "Ez a rövidítés már egy másik partnerhez tartozik. Válassz másikat.",
        );
      }
      throw error;
    }
  }

  assignableUsers(scope: PartnerScope) {
    return this.repository.assignableUsers(scope);
  }

  selectablePartners(scope: PartnerScope) {
    return this.repository.selectablePartners(scope);
  }

  async continueFrom(id: string, actorUserId: string) {
    const result = await this.repository.continueFrom({
      worksheetId: id,
      actorUserId,
    });
    if (!result.ok) {
      if (result.reason === "NOT_FOUND")
        throw new NotFoundException("A munkalap nem található.");
      // Only a signed sheet is final, so only a signed sheet needs a
      // continuation; on anything else the existing draft or a new version is
      // the right move, and the message says which.
      throw new ConflictException(
        "Csak aláírt munkalapot lehet új lapon folytatni. Ez a lap még nincs aláírva: szerkeszd a piszkozatot, vagy adj ki új verziót.",
      );
    }
    return this.detailAfterWrite(result.id);
  }

  /**
   * A lap felelőseinek beállítása.
   *
   * Lezárt lapon is megengedett, és ez szándékos: a kiosztás nem a
   * dokumentum tartalma, hanem munkaszervezés. Egy tévesen kiosztott lapot a
   * lezárás pillanatában sem szabad javíthatatlanul otthagyni, és a lezárt
   * verzió szövegéhez ez akkor sem nyúl hozzá.
   */
  /**
   * A hibajegy alá csatolható lapok.
   *
   * A HIBAJEGY OLDALÁRÓL CSATOLUNK, ÉS EZ TUDATOS VÁLASZTÁS. A másik alak (a
   * lap oldaláról választani hibajegyet) SZÁNDÉKOSAN nincs megépítve: Balázs
   * leírása szerint még a "lap előbb, hibajegy utána" úton is a FELELŐS az,
   * aki a hibajegyet létrehozza, és ő ott áll, amikor a már meglévő lapot alá
   * húzza. Egy felület, két eset.
   *
   * Ha egyszer mégis kell a lap felőli út, ez a lista változatlanul jó hozzá -
   * csak a hívó lesz más. Ezért nem "hiányzó darab", hanem meg nem épített út.
   */
  // A VISSZATERESI TIPUS KI VAN IRVA: a felulet ugyanezt importalja a kozos
  // csomagbol, es kiiras nelkul a ket oldal csak VELETLENUL egyezne - egy
  // atnevezett mezo mindkettoben lefordulna, es a kepernyon `undefined`
  // jelenne meg, hibauzenet nelkul.
  async attachableWorksheets(
    customerId: string,
    scope: PartnerScope,
  ): Promise<WorksheetAttachableListResponse> {
    return this.repository.attachableWorksheets(customerId, scope);
  }

  async setAssignees(
    id: string,
    input: SetWorksheetAssigneesDto,
    actorUserId: string,
  ): Promise<WorksheetDetail> {
    await this.requireWorksheet(id, {
      // BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all, amit partner-oldali
      // felhasznalo nem kap meg, es a metodus a TELJES sort hasznalja, nem csak
      // a letezeset. A hatokort azert irjuk ki, mert a kotelezo parameter a
      // dontest a hivo helyre hozza: itt nem szukitunk, es ez latszik.
      kind: "internal",
    });
    const userIds = normalizeAssigneeIds(input.userIds);
    await this.requireAssignableUsers(userIds);

    const updated = await this.repository.setAssignees({
      worksheetId: id,
      userIds,
      actorUserId,
    });
    if (!updated.ok) throw new NotFoundException("A munkalap nem található.");

    const detail = await this.detailAfterWrite(id);

    // Only the colleagues who were not already on the sheet, and only after it
    // is stored. Sending to everyone on every save would buzz a technician
    // each time the office corrects a line; sending before the write would
    // announce an assignment that might not survive it.
    if (updated.added.length > 0)
      this.notifications?.notifyWorksheetAssignment({
        worksheetId: id,
        subject: detail.currentVersion.subject,
        userIds: updated.added,
      });

    return detail;
  }

  /**
   * A FELELŐSÖK MÁR ITT KIOSZTHATÓK, és ez nem kényelmi rövidítés.
   *
   * Az iroda nyit lapot a szerelőnek: a kiosztás abban a pillanatban ismert,
   * amikor a lap megszületik. Külön lépésre bízva a felvivő azt hiszi, kiadta a
   * munkát, közben a lap senki listáján nem jelenik meg -- és erről semmi nem
   * szól, mert a kiosztatlan lap nem hibás állapot.
   *
   * EGY TRANZAKCIÓBAN ÍRÓDIK a lappal. Külön hívásként a második fele
   * elbukhatna (hálózat, jogosultság, elgépelt azonosító), és pont az a
   * kiosztatlan lap keletkezne, amit el akarunk kerülni. A kollégák
   * ellenőrzése ezért a létrehozás ELŐTT fut: egy ismeretlen azonosító így nem
   * hoz létre semmit, ahelyett hogy egy már meglévő lapot hagyna félkészen.
   */
  async create(
    input: CreateWorksheetDto,
    actorUserId: string,
  ): Promise<WorksheetDetail> {
    await this.requireCustomer(input.customerId);
    await this.requireDepartment(input.departmentId, input.customerId);
    const serviceJobId = input.serviceJobId?.trim() || null;
    // MINDEN ELLENORZES A LETREHOZAS ELOTT FUT, ahogy a felelosoknel is: egy
    // ismeretlen jegyazonosito igy nem hoz letre semmit, ahelyett hogy egy mar
    // megirt lapot hagyna felkeszen.
    if (serviceJobId !== null)
      await this.requireTicketFor(serviceJobId, input.customerId);
    const content = this.normalize(input);
    await this.requireAssets(content);
    const assigneeIds = normalizeAssigneeIds(input.assigneeIds ?? []);
    await this.requireAssignableUsers(assigneeIds);

    const id = await this.repository.createDraft({
      customerId: input.customerId,
      departmentId: input.departmentId,
      content,
      actorUserId,
      assigneeIds,
      serviceJobId,
      clientOperationId: input.clientOperationId,
    });
    const detail = await this.detailAfterWrite(id);

    // Ugyanaz a sorrend, mint a `setAssignees` esetén: értesítés csak azután,
    // hogy a lap tárolva van. Felvitelkor minden felelős új, tehát a lista
    // maga a különbség.
    if (assigneeIds.length > 0)
      this.notifications?.notifyWorksheetAssignment({
        worksheetId: id,
        subject: detail.currentVersion.subject,
        userIds: assigneeIds,
      });

    return detail;
  }

  async updateDraft(
    id: string,
    input: UpdateWorksheetDraftDto,
  ): Promise<WorksheetDetail> {
    const worksheet = await this.requireWorksheet(id, {
      // BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all, amit partner-oldali
      // felhasznalo nem kap meg, es a metodus a TELJES sort hasznalja, nem csak
      // a letezeset. A hatokort azert irjuk ki, mert a kotelezo parameter a
      // dontest a hivo helyre hozza: itt nem szukitunk, es ez latszik.
      kind: "internal",
    });
    const current = worksheet.versions[0];
    if (!current) throw new NotFoundException("A munkalap nem található.");
    if (current.status !== "DRAFT") {
      throw new ConflictException(
        "A lezárt munkalap nem szerkeszthető. Módosításhoz új verziót kell készíteni, indoklással.",
      );
    }

    const content = this.normalize(input);
    await this.requireAssets(content);

    const updated = await this.repository.replaceDraftContent({
      versionId: current.id,
      content,
    });
    if (!updated) {
      throw new ConflictException(
        "A munkalapot időközben lezárták, ezért a piszkozat nem menthető.",
      );
    }
    return this.detailAfterWrite(id);
  }

  async close(
    id: string,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<WorksheetDetail> {
    const result = await this.repository.close(id, actorUserId, now);
    if (!result.ok) throw closeFailure(result.reason);
    return this.detailAfterWrite(id);
  }

  async amend(
    id: string,
    input: AmendWorksheetDto,
    actorUserId: string,
  ): Promise<WorksheetDetail> {
    const changeReason = input.changeReason.trim();
    if (!changeReason) {
      throw new BadRequestException(
        "A módosítás indoklása kötelező: enélkül nem derül ki, miért változott egy már kiadott munkalap.",
      );
    }

    const content = this.normalize(input);
    await this.requireAssets(content);

    const result = await this.repository.amend({
      worksheetId: id,
      content,
      changeReason,
      actorUserId,
    });
    if (!result.ok) {
      if (result.reason === "NOT_FOUND")
        throw new NotFoundException("A munkalap nem található.");
      // The message has to say what to do instead. "Nem módosítható" leaves
      // somebody holding a finished job and no way to record it.
      if (result.reason === "SIGNED")
        throw new ConflictException(
          "Az aláírt munkalap végleges, nem módosítható. A munka folytatása új munkalap, ami erre hivatkozik: nyisd meg a lapot, és válaszd a folytatást.",
        );
      if (result.reason === "NOT_CLOSED")
        throw new ConflictException(
          "A munkalap még piszkozat: szerkeszd a meglévő verziót, új verzió csak lezárt lapból készül.",
        );
      throw new ConflictException(
        "Időközben új verzió készült a munkalapról. Nyisd meg újra, és arra add ki a módosítást.",
      );
    }
    return this.detailAfterWrite(id);
  }

  async sign(
    id: string,
    input: SignWorksheetVersionDto,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<WorksheetDetail> {
    /**
     * AZ ELUTASÍTÁS OKA KÖTELEZŐ (Balázs döntése, 2026-08-26).
     *
     * Indok nélkül a visszautasítás annyit mond, hogy „nem", és sem a lapon
     * dolgozó szerelő, sem a hibajegy kezelője nem tudja, mit kell javítani.
     *
     * A szabály ITT áll, és nem a DTO dekorátorain, mert KÉT mezőt köt össze: a
     * döntést és az indokot. A dekorátoros alak megtévesztő lett volna -- két
     * `ValidateIf` ugyanazon a mezőn nem összeadódik, hanem felülírja egymást,
     * és az indok nélküli elutasítás csendben átment volna.
     *
     * A levágott hosszt nézzük, mert a csupa szóközből álló indok pontosan
     * annyit mond, mint a hiányzó.
     */
    if (input.decision === "REJECTED" && (input.note?.trim().length ?? 0) < 3)
      throw new BadRequestException(
        "Az elutasítás okát meg kell adni, legalább három karakterrel: enélkül nem derül ki, mit kell javítani.",
      );

    const signer = await this.resolveSigner(id, input);
    const result = await this.repository.sign({
      worksheetId: id,
      decision: input.decision,
      signerName: signer.signerName,
      signerUserId: signer.signerUserId,
      signerSource: signer.signerSource,
      note: input.note?.trim() || null,
      actorUserId,
      now,
    });
    if (!result.ok) {
      if (result.reason === "NOT_FOUND")
        throw new NotFoundException("A munkalap nem található.");
      throw new ConflictException(
        "Ez a verzió nem írható alá: vagy még piszkozat, vagy már megszületett róla a döntés.",
      );
    }
    return this.detailAfterWrite(id);
  }

  /**
   * Egy verzió és az előzője közötti mezőnkénti eltérés. Nem tárolt napló,
   * hanem a két megváltoztathatatlan verzióból számolt tény.
   */
  async diff(
    id: string,
    version: number,
    scope: PartnerScope,
  ): Promise<WorksheetVersionDiff> {
    const worksheet = await this.requireWorksheet(id, scope);
    const current = worksheet.versions.find(
      (candidate) => candidate.version === version,
    );
    if (!current)
      throw new NotFoundException("A munkalapnak nincs ilyen verziója.");
    if (version <= 1) {
      throw new BadRequestException(
        "Az első verzióhoz nincs mit hasonlítani: ez a munkalap eredeti tartalma.",
      );
    }
    const previous = worksheet.versions.find(
      (candidate) => candidate.version === version - 1,
    );
    if (!previous)
      throw new NotFoundException("A megelőző verzió nem található.");

    return {
      worksheetId: worksheet.id,
      fromVersion: previous.version,
      toVersion: current.version,
      changeReason: current.changeReason,
      changedByName: current.createdBy?.displayName ?? null,
      changedAt: current.createdAt.toISOString(),
      changes: diffWorksheetVersions(
        toComparableVersion(previous),
        toComparableVersion(current),
      ),
    };
  }

  /**
   * Egy sor hozzáadása a piszkozathoz.
   *
   * A teljes tartalmat cserélő mentés mellé azért kell ez, mert egy lapnak
   * több felelőse lehet: két szerelő közül a második mentése az első összes
   * sorát törölné. Sor-szintű művelettel mindenki a saját sorát írja, és
   * nincs mit felülírni.
   */
  async addLine(
    id: string,
    input: CreateWorksheetLineDto,
  ): Promise<WorksheetDetail> {
    const versionId = await this.requireDraftVersionId(id);
    const line = this.normalizeLine(input);
    await this.requireLineAsset(line);

    const result = await this.repository.addLine({
      versionId,
      lineId: input.id ?? randomUUID(),
      line,
    });
    this.assertLineWritten(result);
    return this.detailAfterWrite(id);
  }

  async updateLine(
    id: string,
    lineId: string,
    input: UpdateWorksheetLineDto,
  ): Promise<WorksheetDetail> {
    const versionId = await this.requireDraftVersionId(id);
    const line = this.normalizeLine(input);
    await this.requireLineAsset(line);

    const result = await this.repository.updateLine({
      versionId,
      lineId,
      line,
    });
    this.assertLineWritten(result);
    return this.detailAfterWrite(id);
  }

  async removeLine(id: string, lineId: string): Promise<WorksheetDetail> {
    const versionId = await this.requireDraftVersionId(id);
    const result = await this.repository.removeLine({ versionId, lineId });
    this.assertLineWritten(result);
    return this.detailAfterWrite(id);
  }

  /**
   * A sorszám a tárolórétegtől jön, a tranzakción belül - itt csak
   * helykitöltő. Két egyszerre rögzítő telefon különben ugyanazt a számot
   * kérné, és az egyedi megszorítás egyiküket eldobná.
   */
  private normalizeLine(input: WorksheetLineDto): NormalizedWorksheetLine {
    return { position: 0, ...normalizeWorksheetLine(input) };
  }

  /** Ugyanaz az eszköz-ellenőrzés, mint a teljes tartalomnál, egy sorra. */
  private async requireLineAsset(line: NormalizedWorksheetLine) {
    if (!line.assetId) return;
    const existing = await this.repository.existingAssetIds([line.assetId]);
    if (!existing.has(line.assetId)) {
      throw new BadRequestException(
        "A tételen hivatkozott eszköz nem található.",
      );
    }
  }

  /**
   * AKI ALAIRHATJA A LAPOT: a lap partnerenek nyilvantartott munkatarsai.
   *
   * A HALMAZ A `User.customerId` MEZOBOL JON -- azok a fiokok, amiket a lap
   * vevojehez kotottek. Ugyanaz az azonosito-ter, amit a lap visel: a
   * munkalap partneret a szervizpartner-valaszto adja, es az a partner
   * TUKOR-VEVO soranak azonositojat adja vissza. Vagyis ez EGYENES egyezes,
   * nem join a partneren keresztul.
   *
   * BELSOS UT, mint a tobbi sor-vegpont: a valaszto a szerelo eszkoze.
   */
  async signerCandidates(id: string) {
    const worksheet = await this.requireWorksheet(id, { kind: "internal" });
    const items = await this.repository.customerContacts(worksheet.customerId);
    const partnerSelectable = await this.repository.isSelectablePartner(
      worksheet.customerId,
    );
    return {
      items,
      emptyReason: describeEmptySignerList({
        partnerSelectable,
        count: items.length,
      }),
    };
  }

  /**
   * KI IRJA ALA, ES HONNAN JON A NEVE.
   *
   * A FORRAST A SZERVER SZAMOLJA, NEM A KLIENS KERDI: ha a hivo kuldene egy
   * "forras" mezot, az ellentmondhatna a valasztott szemelynek, es akkor a
   * lapon egy HAMIS jelzes allna. Igy a ketto nem tud elcsuszni.
   *
   * ES A NEVET A VALASZTOTT SOR ADJA, nem a kliens: egy klienstol jovo nev
   * ilyenkor azt jelentene, hogy a lapra MAS nev kerul, mint akit valasztottak.
   */
  private async resolveSigner(
    worksheetId: string,
    input: SignWorksheetVersionDto,
  ): Promise<{
    signerName: string;
    signerUserId: string | null;
    signerSource: "SELECTED" | "TYPED";
  }> {
    if (input.signerUserId) {
      const worksheet = await this.requireWorksheet(worksheetId, {
        kind: "internal",
      });
      const contacts = await this.repository.customerContacts(
        worksheet.customerId,
      );
      const picked = contacts.find((c) => c.id === input.signerUserId);
      /**
       * A VALASZTOTT SZEMELY A LAP PARTNEREHEZ TARTOZZON. Enelkul a hivo
       * BARMELYIK felhasznalo azonositojat kuldhetne, es a lapra egy idegen
       * ember neve kerulne -- ugy, hogy a jelzes szerint a partner
       * nyilvantartott munkatarsa irta ala.
       */
      if (!picked)
        throw new BadRequestException(
          "A választott aláíró nem a munkalap partnerének munkatársa, ezért nem írhatja alá.",
        );
      return {
        signerName: picked.name,
        signerUserId: picked.id,
        signerSource: "SELECTED",
      };
    }
    /**
     * "EGYIK SEM": a szerelo irja be a nevet, es a lap ezt KIMONDJA. A
     * kotelezoseg ITT all, nem a DTO dekoratorain, mert KET mezot kot ossze.
     */
    const typed = input.signerName?.trim() ?? "";
    if (typed.length < 2)
      throw new BadRequestException(
        "Válassz aláírót a listáról, vagy add meg a nevét legalább két karakterrel.",
      );
    return { signerName: typed, signerUserId: null, signerSource: "TYPED" };
  }

  /**
   * A MUNKANAPLO EGY LAPON.
   *
   * BELSOS UT, ES EZ DONTES. A bejegyzes a MI munkanaplonk: arrol szol, mit
   * csinalt a szerelo, sajat szavaival. Balazs nem mondta ki, hogy a partner
   * lassa, es a ket tevedes ara nem egyforma -- egy elmaradt lathatosag
   * PANASZT szul (valaki keri), egy keretlen viszont a partner ele visz belso
   * jegyzetet, es arrol soha nem tudunk meg.
   *
   * Ugyanaz a szukites, mint a sor-vegpontoknal, es ugyanabban az alakban: a
   * hatokort a hivo helyen irjuk ki, hogy latszodjon.
   */
  async entries(id: string, actorUserId: string) {
    const data = await this.repository.entries(id);
    if (!data) throw new NotFoundException("A munkalap nem található.");
    const context = {
      userId: actorUserId,
      worksheetCreatedById: data.worksheetCreatedById,
      serviceJobOpenedById: data.serviceJobOpenedById,
    };
    const canEdit = canEditWorksheetEntry(context);
    const editRefusal = describeEntryEditRefusal(context);
    return {
      items: data.rows.map((row) => ({
        id: row.id,
        body: row.body,
        authorName: row.authorName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        /**
         * A JOG A LAPRA SZOL, NEM A SORRA: a szabaly a lap keszitojet es a jegy
         * nyitojat nezi, tehat MINDEN bejegyzesre ugyanaz az eredmeny. Megis
         * soronkent all a valaszban, mert a felulet soronkent rajzol gombot --
         * es ha egyszer a szabaly a szerzot is bevonna, a valasz alakja nem
         * valtozna.
         */
        canEdit,
        editRefusal,
      })),
    };
  }

  /**
   * UJ BEJEGYZES. A SZERZO A BEJELENTKEZETT KOLLEGA, es a hivo nem adhatja meg:
   * egy kliens-oldali szerzo-mezo azt jelentene, hogy barki barki neveben irhat
   * a naploba.
   *
   * A LAP ALLAPOTA NEM SZAMIT, es ez szandekos. Egy alairt lapra is lehet
   * bejegyzest irni: a naplo arrol szol, mi tortent, es a tiltas NEMAN
   * veszitene el egy jegyzetet. Az engedes LATSZIK, mert a bejegyzesen ott az
   * idopont -- az alairas utani darabok utana allnak a listaban.
   */
  async addEntry(id: string, body: string, actorUserId: string) {
    await this.requireWorksheet(id, { kind: "internal" });
    await this.repository.addEntry({
      worksheetId: id,
      body: body.trim(),
      authorId: actorUserId,
    });
    return this.entries(id, actorUserId);
  }

  /**
   * EGY BEJEGYZES ATIRASA.
   *
   * A JOGOSULTSAG ITT DOL EL, ES NEM A KEPERNYON. A valasz `canEdit` mezoje
   * ugyanebbol a fuggvenybol szuletik, tehat a ket oldal nem tud elcsuszni --
   * de ha csak a kepernyo szurne, a vegpontot barki hivhatna kozvetlenul.
   */
  async updateEntry(
    id: string,
    entryId: string,
    body: string,
    actorUserId: string,
  ) {
    const data = await this.repository.entries(id);
    if (!data) throw new NotFoundException("A munkalap nem található.");
    const context = {
      userId: actorUserId,
      worksheetCreatedById: data.worksheetCreatedById,
      serviceJobOpenedById: data.serviceJobOpenedById,
    };
    if (!canEditWorksheetEntry(context))
      throw new ForbiddenException(
        describeEntryEditRefusal(context) ??
          "Ezt a bejegyzést nem szerkesztheted.",
      );
    const changed = await this.repository.updateEntry({
      worksheetId: id,
      entryId,
      body: body.trim(),
    });
    /**
     * A NULLA MOZDULT SOR NEM SIKER. Vagy nincs ilyen bejegyzes, vagy MASIK
     * lapé -- a `WHERE` a lapra is szur. A ketto a hivo szamara ugyanaz a
     * teendo: rossz azonositot adott.
     */
    if (changed !== 1)
      throw new NotFoundException("Ezen a munkalapon nincs ilyen bejegyzés.");
    return this.entries(id, actorUserId);
  }

  private async requireDraftVersionId(id: string): Promise<string> {
    const worksheet = await this.requireWorksheet(id, {
      // BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all, amit partner-oldali
      // felhasznalo nem kap meg, es a metodus a TELJES sort hasznalja, nem csak
      // a letezeset. A hatokort azert irjuk ki, mert a kotelezo parameter a
      // dontest a hivo helyre hozza: itt nem szukitunk, es ez latszik.
      kind: "internal",
    });
    const current = worksheet.versions[0];
    if (!current) throw new NotFoundException("A munkalap nem található.");
    if (current.status !== "DRAFT") {
      throw new ConflictException(
        "A lezárt munkalap nem szerkeszthető. Módosításhoz új verziót kell készíteni, indoklással.",
      );
    }
    return current.id;
  }

  /**
   * Az `alreadyPresent` NEM hiba, ezért nincs is ága: a telefon újraküldött
   * egy műveletet, ami már megtörtént, és a lap attól ugyanabban az
   * állapotban van, mint amit a hívó kért.
   */
  private assertLineWritten(result: WorksheetLineWriteResult): void {
    if (result.outcome === "version-gone") {
      throw new ConflictException(
        "A munkalapot időközben lezárták, ezért a tétel nem menthető.",
      );
    }
    if (result.outcome === "line-gone") {
      throw new NotFoundException("A munkalapon nincs ilyen tétel.");
    }
  }

  private normalize(input: WorksheetContentDto): NormalizedWorksheetContent {
    try {
      return normalizeWorksheetContent(input);
    } catch {
      throw new BadRequestException(
        "A megadott dátum érvénytelen. Használj éééé-hh-nn alakot.",
      );
    }
  }

  private async requireWorksheet(
    id: string,
    scope: PartnerScope,
  ): Promise<WorksheetDetailRow> {
    const worksheet = await this.repository.detail(id, scope);
    if (!worksheet) throw new NotFoundException("A munkalap nem található.");
    return worksheet;
  }

  /**
   * A hiányzó és a nem jogosult kolléga ugyanazt a választ kapja, mert a
   * hívó számára ugyanaz a teendő: mást kell választani. A kettő
   * szétválasztása annyit árulna el, hogy egy adott azonosító létezik-e.
   */
  private async requireAssignableUsers(userIds: readonly string[]) {
    if (userIds.length === 0) return;
    const assignable = await this.repository.assignableUserIds(userIds);
    const rejected = userIds.filter((userId) => !assignable.has(userId));
    if (rejected.length > 0) {
      throw new BadRequestException(
        "A felelősnek jelölt kolléga nem található, vagy a szerepköre nem engedi a munkalap szerkesztését.",
      );
    }
  }

  /**
   * A `customerId` a partner tükör vevő-sorára mutat, és a felhasználó
   * partnert választott, nem vevőt: minden hívó út a partner adatlapjáról
   * vagy a munkalap partnerválasztójából indul. Ezért az üzenet partnert
   * mond - a vevő szó itt a tárolás nyelve, nem azé, aki olvassa.
   */
  /**
   * A JEGY LETEZIK-E, ES FOGADHATJA-E EZT A LAPOT.
   *
   * A SZABALY KOZOS A CSATOLASSAL (`common/worksheet-under-ticket.ts`), a
   * MONDAT viszont ezé az uté: itt a lap MOST keletkezne, tehat a felhasznalo
   * nem masik lapot valaszt, hanem vagy a jegyet, vagy a partnert javitja.
   */
  private async requireTicketFor(serviceJobId: string, customerId: string) {
    const ticket = await this.repository.ticketPartner(serviceJobId);
    if (!ticket)
      throw new NotFoundException("A megadott hibajegy nem található.");

    const check = mayWorksheetJoinTicket({
      ticketCustomerId: ticket.customerId,
      worksheetCustomerId: customerId,
    });
    if (!check.ok)
      throw new BadRequestException(
        check.reason === "ticket-has-no-partner"
          ? "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét, és utána nyiss alá munkalapot."
          : "A munkalap partnere nem egyezik a hibajegyével. Válassz másik hibajegyet, vagy javítsd a lap partnerét.",
      );
  }

  private async requireCustomer(customerId: string) {
    const customer = await this.repository.customer(customerId);
    if (!customer)
      throw new NotFoundException("A megadott partner nem található.");
    return customer;
  }

  private async requireDepartment(departmentId: string, customerId: string) {
    const department = await this.repository.department(departmentId);
    if (!department || department.customerId !== customerId) {
      throw new BadRequestException(
        "A megadott alegység nem ehhez a partnerhez tartozik.",
      );
    }
    if (!department.isActive) {
      throw new BadRequestException("A megadott alegység már nem aktív.");
    }
    return department;
  }

  private async requireAssets(content: NormalizedWorksheetContent) {
    const assetIds = [
      ...new Set(
        content.lines
          .map((line) => line.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ),
    ];
    if (assetIds.length === 0) return;
    const existing = await this.repository.existingAssetIds(assetIds);
    const missing = assetIds.filter((assetId) => !existing.has(assetId));
    if (missing.length > 0) {
      throw new BadRequestException(
        "A tételen hivatkozott eszköz nem található.",
      );
    }
  }
}
