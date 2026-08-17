import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { WorksheetDetail, WorksheetVersionDiff } from "@acropora/types";

import type {
  AmendWorksheetDto,
  CreateWorksheetDepartmentDto,
  CreateWorksheetDto,
  SetWorksheetPartnerCodeDto,
  SignWorksheetVersionDto,
  UpdateWorksheetDraftDto,
  WorksheetContentDto,
  WorksheetListQueryDto,
} from "./dto/worksheet.dto.js";
import {
  normalizeWorksheetContent,
  type NormalizedWorksheetContent,
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
  constructor(private readonly repository: WorksheetsRepository) {}

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
          "Ehhez a partnerhez már tartozik ilyen kódú részleg.",
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Ez a rövidítés már egy másik partnerhez tartozik. A munkalap-számnak egyértelműen kell azonosítania a partnert.",
        );
      }
      throw error;
    }
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

  private async requireCustomer(customerId: string) {
    const customer = await this.repository.customer(customerId);
    if (!customer) throw new NotFoundException("A vevő nem található.");
    return customer;
  }

  private async requireDepartment(departmentId: string, customerId: string) {
    const department = await this.repository.department(departmentId);
    if (!department || department.customerId !== customerId) {
      throw new BadRequestException(
        "A megadott részleg nem ehhez a partnerhez tartozik.",
      );
    }
    if (!department.isActive) {
      throw new BadRequestException("A megadott részleg már nem aktív.");
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
