import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { WorksheetDetail, WorksheetVersionDiff } from "@acropora/types";

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
  constructor(
    private readonly repository: WorksheetsRepository,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  list(query: WorksheetListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string): Promise<WorksheetDetail> {
    return toWorksheetDetail(await this.requireWorksheet(id));
  }

  async departments(customerId: string) {
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

  assignableUsers() {
    return this.repository.assignableUsers();
  }

  selectablePartners() {
    return this.repository.selectablePartners();
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
    return this.detail(result.id);
  }

  /**
   * A lap felelőseinek beállítása.
   *
   * Lezárt lapon is megengedett, és ez szándékos: a kiosztás nem a
   * dokumentum tartalma, hanem munkaszervezés. Egy tévesen kiosztott lapot a
   * lezárás pillanatában sem szabad javíthatatlanul otthagyni, és a lezárt
   * verzió szövegéhez ez akkor sem nyúl hozzá.
   */
  async setAssignees(
    id: string,
    input: SetWorksheetAssigneesDto,
    actorUserId: string,
  ): Promise<WorksheetDetail> {
    await this.requireWorksheet(id);
    const userIds = normalizeAssigneeIds(input.userIds);
    await this.requireAssignableUsers(userIds);

    const updated = await this.repository.setAssignees({
      worksheetId: id,
      userIds,
      actorUserId,
    });
    if (!updated.ok) throw new NotFoundException("A munkalap nem található.");

    const detail = await this.detail(id);

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

  async create(
    input: CreateWorksheetDto,
    actorUserId: string,
  ): Promise<WorksheetDetail> {
    await this.requireCustomer(input.customerId);
    await this.requireDepartment(input.departmentId, input.customerId);
    const content = this.normalize(input);
    await this.requireAssets(content);

    const id = await this.repository.createDraft({
      customerId: input.customerId,
      departmentId: input.departmentId,
      content,
      actorUserId,
    });
    return this.detail(id);
  }

  async updateDraft(
    id: string,
    input: UpdateWorksheetDraftDto,
  ): Promise<WorksheetDetail> {
    const worksheet = await this.requireWorksheet(id);
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
    return this.detail(id);
  }

  async close(
    id: string,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<WorksheetDetail> {
    const result = await this.repository.close(id, actorUserId, now);
    if (!result.ok) throw closeFailure(result.reason);
    return this.detail(id);
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
    return this.detail(id);
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

    const result = await this.repository.sign({
      worksheetId: id,
      decision: input.decision,
      signerName: input.signerName.trim(),
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
    return this.detail(id);
  }

  /**
   * Egy verzió és az előzője közötti mezőnkénti eltérés. Nem tárolt napló,
   * hanem a két megváltoztathatatlan verzióból számolt tény.
   */
  async diff(id: string, version: number): Promise<WorksheetVersionDiff> {
    const worksheet = await this.requireWorksheet(id);
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
    return this.detail(id);
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
    return this.detail(id);
  }

  async removeLine(id: string, lineId: string): Promise<WorksheetDetail> {
    const versionId = await this.requireDraftVersionId(id);
    const result = await this.repository.removeLine({ versionId, lineId });
    this.assertLineWritten(result);
    return this.detail(id);
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

  private async requireDraftVersionId(id: string): Promise<string> {
    const worksheet = await this.requireWorksheet(id);
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

  private async requireWorksheet(id: string): Promise<WorksheetDetailRow> {
    const worksheet = await this.repository.detail(id);
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
