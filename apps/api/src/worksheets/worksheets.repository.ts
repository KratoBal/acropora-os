import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import {
  personDisplayName,
  type WorksheetAssignableUserListResponse,
  type WorksheetSelectablePartnerListResponse,
  type WorksheetDepartmentListResponse,
  type WorksheetDepartmentSummary,
  type WorksheetListResponse,
} from "@acropora/types";

import type {
  CreateWorksheetDepartmentDto,
  WorksheetListQueryDto,
} from "./dto/worksheet.dto.js";
import { sumWorksheetAmounts } from "./worksheet-amounts.js";
import { WORKSHEET_ASSIGNABLE_ROLES } from "./worksheet-assignment.js";
import type {
  NormalizedWorksheetContent,
  NormalizedWorksheetLine,
} from "./worksheet-content.js";
import {
  buildWorksheetNumber,
  worksheetNumberIssue,
  worksheetYear,
  type WorksheetNumberIssue,
} from "./worksheet-number.js";
import {
  toWorksheetListItem,
  worksheetDetailInclude,
  worksheetSummaryInclude,
  type WorksheetDetailRow,
  type WorksheetLineWriteResult,
} from "./worksheets.types.js";

export type WorksheetCloseFailure =
  "NOT_FOUND" | "NOT_DRAFT" | "NO_LINES" | WorksheetNumberIssue;

export type WorksheetCloseResult =
  { ok: true } | { ok: false; reason: WorksheetCloseFailure };

export type WorksheetAmendResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "NOT_FOUND" | "NOT_CLOSED" | "SIGNED" | "CONCURRENT_VERSION";
    };

export type WorksheetSignResult =
  { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_AWAITING_SIGNATURE" };

type TransactionClient = Prisma.TransactionClient;

/**
 * Az alegység neve nem a beküldött tartalomból jön, hanem a munkalap
 * alegységéből, a kiírás pillanatában. Így a lapon látható egység és a szám
 * középső tagja ugyanaz a sor, egy későbbi átnevezés viszont nem írja át
 * visszamenőleg a már lezárt verziót.
 */
function versionContentData(
  content: NormalizedWorksheetContent,
  unitName: string,
) {
  return {
    subject: content.subject,
    unitName,
    description: content.description,
    issueDate: content.issueDate,
    fulfillmentDate: content.fulfillmentDate,
    dueDate: content.dueDate,
    netAmount: content.totals.netAmount,
    vatAmount: content.totals.vatAmount,
    grossAmount: content.totals.grossAmount,
  };
}

function lineData(content: NormalizedWorksheetContent, versionId: string) {
  return content.lines.map((line) => ({
    worksheetVersionId: versionId,
    position: line.position,
    description: line.description,
    detail: line.detail,
    assetId: line.assetId,
    quantity: line.quantity,
    unit: line.unit,
    unitNet: line.unitNet,
    vatRatePercent: line.vatRatePercent,
    netAmount: line.netAmount,
    vatAmount: line.vatAmount,
    grossAmount: line.grossAmount,
  }));
}

@Injectable()
export class WorksheetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  customer(id: string) {
    return this.database.customer.findUnique({
      where: { id },
      select: {
        id: true,
        customerNumber: true,
        displayName: true,
        worksheetPartnerCode: true,
        isActive: true,
      },
    });
  }

  async setPartnerCode(customerId: string, partnerCode: string) {
    return this.database.customer.update({
      where: { id: customerId },
      data: { worksheetPartnerCode: partnerCode },
      select: {
        id: true,
        customerNumber: true,
        displayName: true,
        worksheetPartnerCode: true,
      },
    });
  }

  async departments(
    customerId: string,
  ): Promise<WorksheetDepartmentListResponse> {
    const items = await this.database.worksheetDepartment.findMany({
      where: { customerId },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: { code: "asc" },
    });
    return { items };
  }

  async createDepartment(
    customerId: string,
    input: CreateWorksheetDepartmentDto,
  ): Promise<WorksheetDepartmentSummary> {
    return this.database.worksheetDepartment.create({
      data: {
        customerId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
  }

  department(id: string) {
    return this.database.worksheetDepartment.findUnique({
      where: { id },
      select: { id: true, customerId: true, code: true, isActive: true },
    });
  }

  /**
   * Four conditions, and the middle two are the point.
   *
   * A partner with no code could be picked, worked on, and then refuse to
   * close -- the number cannot be built without its first segment. The
   * technician would be standing in front of the customer when that came out,
   * and it is not something they can fix. So the pressure sits here, on the
   * list, where the gap is visible to whoever can close it.
   *
   * A partner with no mirror row has no worksheets to belong to. It cannot
   * happen for a service partner saved through the partner screen, which
   * creates the row, but a list that assumes its own invariants is how a
   * missing row turns into a crash instead of an absence.
   */
  static selectablePartnerWhere(): Prisma.SupplierWhereInput {
    return {
      isService: true,
      isActive: true,
      worksheetPartnerCode: { not: null },
      customerId: { not: null },
    };
  }

  async selectablePartners(): Promise<WorksheetSelectablePartnerListResponse> {
    const rows = await this.database.supplier.findMany({
      where: WorksheetsRepository.selectablePartnerWhere(),
      select: { name: true, worksheetPartnerCode: true, customerId: true },
    });
    const items = rows
      .map((row) => ({
        customerId: row.customerId!,
        name: row.name,
        partnerCode: row.worksheetPartnerCode!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "hu"));
    return { items };
  }

  /**
   * Akiket felelősnek fel lehet ajánlani. A rendezés a MEGJELENÍTETT néven
   * fut, nem a hivatalos néven: a lista a becenevet mutatja, tehát az
   * adatbázis-oldali `displayName` szerinti sorrend a felületen
   * rendezetlennek látszana.
   */
  async assignableUsers(): Promise<WorksheetAssignableUserListResponse> {
    const rows = await this.database.user.findMany({
      where: { isActive: true, role: { in: [...WORKSHEET_ASSIGNABLE_ROLES] } },
      select: { id: true, displayName: true, nickname: true, role: true },
    });
    const items = rows
      .map((row) => ({
        id: row.id,
        name: personDisplayName(row),
        role: row.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "hu"));
    return { items };
  }

  /** A megadottak közül azok, akik ma tényleg kioszthatók. */
  async assignableUserIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.database.user.findMany({
      where: {
        id: { in: [...ids] },
        isActive: true,
        role: { in: [...WORKSHEET_ASSIGNABLE_ROLES] },
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * A lap felelőseinek beállítása. A beküldött lista a teljes névsor: aki
   * nincs rajta, lekerül.
   *
   * A már fent lévő sorokhoz NEM nyúlunk (`skipDuplicates`), és ez nem
   * takarékosság: az `assignedAt` az egyetlen jel arról, ki KERÜLT ÚJONNAN a
   * lapra. Ha minden mentés újraírná az összes sort, az értesítés ("új
   * munkalapod van") minden szerkesztésnél mindenkinek újra kimenne.
   */
  async setAssignees(input: {
    worksheetId: string;
    userIds: readonly string[];
    actorUserId: string;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const worksheet = await transaction.worksheet.findUnique({
        where: { id: input.worksheetId },
        select: { id: true },
      });
      if (!worksheet) return false;

      await transaction.worksheetAssignee.deleteMany({
        where: {
          worksheetId: input.worksheetId,
          ...(input.userIds.length > 0
            ? { userId: { notIn: [...input.userIds] } }
            : {}),
        },
      });

      if (input.userIds.length > 0) {
        await transaction.worksheetAssignee.createMany({
          data: input.userIds.map((userId) => ({
            worksheetId: input.worksheetId,
            userId,
            assignedById: input.actorUserId,
          })),
          skipDuplicates: true,
        });
      }
      return true;
    });
  }

  async existingAssetIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.database.asset.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async list(query: WorksheetListQueryDto): Promise<WorksheetListResponse> {
    const where: Prisma.WorksheetWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.assigneeId
        ? { assignees: { some: { userId: query.assigneeId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: "insensitive" } },
              {
                customer: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                versions: {
                  some: {
                    subject: { contains: query.search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.database.worksheet.findMany({
        where,
        include: worksheetSummaryInclude,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.worksheet.count({ where }),
    ]);

    return {
      items: rows.map(toWorksheetListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  detail(id: string): Promise<WorksheetDetailRow | null> {
    return this.database.worksheet.findUnique({
      where: { id },
      include: worksheetDetailInclude,
    });
  }

  async createDraft(input: {
    customerId: string;
    departmentId: string;
    content: NormalizedWorksheetContent;
    actorUserId: string;
  }): Promise<string> {
    return this.database.$transaction(async (transaction) => {
      const department =
        await transaction.worksheetDepartment.findUniqueOrThrow({
          where: { id: input.departmentId },
          select: { name: true },
        });
      const worksheet = await transaction.worksheet.create({
        data: {
          customerId: input.customerId,
          departmentId: input.departmentId,
          createdById: input.actorUserId,
          versions: {
            create: {
              version: 1,
              status: "DRAFT",
              createdById: input.actorUserId,
              ...versionContentData(input.content, department.name),
            },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });

      const versionId = worksheet.versions[0]?.id;
      if (!versionId) throw new Error("WORKSHEET_VERSION_NOT_CREATED");
      await this.writeLines(transaction, versionId, input.content);
      return worksheet.id;
    });
  }

  /**
   * Piszkozat tartalmának cseréje. A sorokat teljes egészében újraírja: a
   * beküldött lista a lap tartalma, nem egy javaslat hozzá.
   */
  async replaceDraftContent(input: {
    versionId: string;
    content: NormalizedWorksheetContent;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const version = await transaction.worksheetVersion.findUnique({
        where: { id: input.versionId },
        select: {
          worksheet: { select: { department: { select: { name: true } } } },
        },
      });
      if (!version) return false;

      const claimed = await transaction.worksheetVersion.updateMany({
        where: { id: input.versionId, status: "DRAFT" },
        data: versionContentData(
          input.content,
          version.worksheet.department.name,
        ),
      });
      if (claimed.count !== 1) return false;

      await transaction.worksheetLine.deleteMany({
        where: { worksheetVersionId: input.versionId },
      });
      await this.writeLines(transaction, input.versionId, input.content);
      return true;
    });
  }

  /**
   * Lezárás: itt és csak itt kap sorszámot a lap. A verzió állapotát
   * feltételes írás foglalja le (`status: "DRAFT"`), így két egyszerre
   * indított lezárásból a második nem kap saját sorszámot, hanem elakad.
   */
  async close(
    worksheetId: string,
    actorUserId: string,
    now: Date,
  ): Promise<WorksheetCloseResult> {
    return this.database.$transaction(async (transaction) => {
      const worksheet = await transaction.worksheet.findUnique({
        where: { id: worksheetId },
        select: {
          id: true,
          number: true,
          customer: { select: { worksheetPartnerCode: true } },
          department: { select: { code: true } },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              _count: { select: { lines: true } },
            },
          },
        },
      });
      if (!worksheet) return { ok: false, reason: "NOT_FOUND" } as const;

      const current = worksheet.versions[0];
      if (!current) return { ok: false, reason: "NOT_FOUND" } as const;
      if (current.status !== "DRAFT")
        return { ok: false, reason: "NOT_DRAFT" } as const;
      if (current._count.lines === 0)
        return { ok: false, reason: "NO_LINES" } as const;

      const partnerCode = worksheet.customer.worksheetPartnerCode;
      const departmentCode = worksheet.department.code;
      if (!worksheet.number) {
        const issue = worksheetNumberIssue({ partnerCode, departmentCode });
        if (issue) return { ok: false, reason: issue } as const;
      }

      const claimed = await transaction.worksheetVersion.updateMany({
        where: { id: current.id, status: "DRAFT" },
        data: {
          status: "AWAITING_SIGNATURE",
          closedAt: now,
          closedById: actorUserId,
        },
      });
      if (claimed.count !== 1)
        return { ok: false, reason: "NOT_DRAFT" } as const;

      if (!worksheet.number && partnerCode) {
        const year = worksheetYear(now);
        const sequence = await this.allocateSequence(
          transaction,
          partnerCode,
          departmentCode,
          year,
        );
        const allocated = buildWorksheetNumber({
          partnerCode,
          departmentCode,
          year,
          sequence,
        });
        await transaction.worksheet.update({
          where: { id: worksheet.id },
          data: {
            number: allocated.number,
            numberYear: allocated.year,
            sequence: allocated.sequence,
          },
        });
      }

      return { ok: true } as const;
    });
  }

  /**
   * Lezárt lap módosítása: ÚJ verzió, a korábbi érintetlenül marad. A szám
   * nem változik, tehát itt sorszámot nem osztunk.
   */
  /**
   * The continuation of a signed sheet: a NEW worksheet for the same partner
   * and unit, pointing back at the one it continues.
   *
   * A draft, not a closed sheet, because the work has not been done yet. It
   * takes its own number when it is closed, from the same series -- two
   * documents signed separately must not share one number.
   */
  async continueFrom(input: {
    worksheetId: string;
    actorUserId: string;
  }): Promise<
    { ok: true; id: string } | { ok: false; reason: "NOT_FOUND" | "NOT_SIGNED" }
  > {
    return await this.database.$transaction(async (transaction) => {
      const source = await transaction.worksheet.findUnique({
        where: { id: input.worksheetId },
        select: {
          id: true,
          customerId: true,
          departmentId: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { status: true, subject: true },
          },
        },
      });
      if (!source) return { ok: false, reason: "NOT_FOUND" } as const;
      const current = source.versions[0];
      // Only a signed sheet is final, so only a signed sheet needs a
      // continuation. On anything else the existing draft or a new version is
      // the right move, and offering this instead would fork a document that
      // nobody has committed to yet.
      if (!current || current.status !== "SIGNED")
        return { ok: false, reason: "NOT_SIGNED" } as const;

      const created = await transaction.worksheet.create({
        data: {
          customerId: source.customerId,
          departmentId: source.departmentId,
          createdById: input.actorUserId,
          continuesWorksheetId: source.id,
          versions: {
            create: {
              version: 1,
              status: "DRAFT",
              subject: current.subject,
            },
          },
        },
        select: { id: true },
      });
      return { ok: true, id: created.id } as const;
    });
  }

  async amend(input: {
    worksheetId: string;
    content: NormalizedWorksheetContent;
    changeReason: string;
    actorUserId: string;
  }): Promise<WorksheetAmendResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const worksheet = await transaction.worksheet.findUnique({
          where: { id: input.worksheetId },
          select: {
            id: true,
            department: { select: { name: true } },
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { version: true, status: true },
            },
          },
        });
        if (!worksheet) return { ok: false, reason: "NOT_FOUND" } as const;

        const current = worksheet.versions[0];
        if (!current) return { ok: false, reason: "NOT_FOUND" } as const;
        if (current.status === "DRAFT")
          return { ok: false, reason: "NOT_CLOSED" } as const;
        // A signed sheet is final. Until now the only refusal was DRAFT, so a
        // signed version could be amended into a new one -- the signature
        // would sit on a version nobody reads any more, while the document it
        // was given for had quietly changed underneath it. The continuation is
        // a NEW sheet instead.
        if (current.status === "SIGNED")
          return { ok: false, reason: "SIGNED" } as const;

        const version = current.version + 1;
        const created = await transaction.worksheetVersion.create({
          data: {
            worksheetId: worksheet.id,
            version,
            status: "DRAFT",
            changeReason: input.changeReason,
            createdById: input.actorUserId,
            ...versionContentData(input.content, worksheet.department.name),
          },
          select: { id: true },
        });
        await this.writeLines(transaction, created.id, input.content);
        return { ok: true, version } as const;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, reason: "CONCURRENT_VERSION" };
      }
      throw error;
    }
  }

  /**
   * Aláírás rögzítése egy VERZIÓRA. Csak a lap legutolsó, lezárt és még
   * aláíratlan verziója írható alá: egy korábbi verzió aláírása olyan
   * tartalmat igazolna, amit már felülírt egy újabb.
   */
  async sign(input: {
    worksheetId: string;
    decision: "ACCEPTED" | "REJECTED";
    signerName: string;
    note: string | null;
    actorUserId: string;
    now: Date;
  }): Promise<WorksheetSignResult> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.worksheetVersion.findFirst({
        where: { worksheetId: input.worksheetId },
        orderBy: { version: "desc" },
        select: { id: true, status: true },
      });
      if (!current) return { ok: false, reason: "NOT_FOUND" } as const;

      const claimed = await transaction.worksheetVersion.updateMany({
        where: { id: current.id, status: "AWAITING_SIGNATURE" },
        data: {
          status: input.decision === "ACCEPTED" ? "SIGNED" : "REJECTED",
        },
      });
      if (claimed.count !== 1)
        return { ok: false, reason: "NOT_AWAITING_SIGNATURE" } as const;

      await transaction.worksheetVersionSignature.create({
        data: {
          worksheetVersionId: current.id,
          decision: input.decision,
          signerName: input.signerName,
          signedByUserId: input.actorUserId,
          signedAt: input.now,
          note: input.note,
        },
      });
      return { ok: true } as const;
    });
  }

  private async writeLines(
    transaction: TransactionClient,
    versionId: string,
    content: NormalizedWorksheetContent,
  ): Promise<void> {
    if (content.lines.length === 0) return;
    await transaction.worksheetLine.createMany({
      data: lineData(content, versionId),
    });
  }

  /**
   * Sorszám-kiosztás partner + részleg + év hármasra, egyetlen atomi
   * írással. Ugyanabban a tranzakcióban fut, mint a lezárás: ha a lezárás
   * elhasal, a sorszám sem vész el, tehát a sorozat hiánytalan marad.
   */
  /**
   * Egy sor hozzáadása a piszkozathoz, a lap többi sorának érintése nélkül.
   *
   * Ez az egyetlen ok, amiért ez a metódus létezik: a teljes tartalmat
   * cserélő mentés két szerelő mellett garantáltan adatot veszít - a második
   * mentés az első összes sorát törli. Nem versenyhelyzet, hanem biztos
   * következmény, mert egy lapnak több felelőse lehet.
   *
   * A sorszámot a szerver adja, a tranzakción belül. Ha a kliens küldené,
   * két egyszerre rögzítő telefon ugyanazt a számot kérné, és az egyedi
   * megszorítás egyiküket eldobná.
   */
  async addLine(input: {
    versionId: string;
    lineId: string;
    line: NormalizedWorksheetLine;
  }): Promise<WorksheetLineWriteResult> {
    return this.database.$transaction(async (transaction) => {
      const claimable = await this.draftLines(transaction, input.versionId);
      if (!claimable) return { outcome: "version-gone" };

      // Ugyanaz az azonosító már bent van: a telefon újraküldött egy sort,
      // amit a szerver az első alkalommal felvett. Ilyenkor nem hiba
      // történt, csak nincs mit tenni.
      if (claimable.lines.some((line) => line.id === input.lineId)) {
        return { outcome: "ok", alreadyPresent: true };
      }

      const position =
        claimable.lines.reduce((max, line) => Math.max(max, line.position), 0) +
        1;

      await transaction.worksheetLine.create({
        data: {
          id: input.lineId,
          worksheetVersionId: input.versionId,
          position,
          description: input.line.description,
          detail: input.line.detail,
          assetId: input.line.assetId,
          quantity: input.line.quantity,
          unit: input.line.unit,
          unitNet: input.line.unitNet,
          vatRatePercent: input.line.vatRatePercent,
          netAmount: input.line.netAmount,
          vatAmount: input.line.vatAmount,
          grossAmount: input.line.grossAmount,
        },
      });

      await this.refreshTotals(transaction, input.versionId);
      return { outcome: "ok", alreadyPresent: false };
    });
  }

  /** Egy sor teljes tartalmának cseréje. A sorszám nem változik: a sorrend
   * a lapé, nem a szerkesztésé. */
  async updateLine(input: {
    versionId: string;
    lineId: string;
    line: NormalizedWorksheetLine;
  }): Promise<WorksheetLineWriteResult> {
    return this.database.$transaction(async (transaction) => {
      const claimable = await this.draftLines(transaction, input.versionId);
      if (!claimable) return { outcome: "version-gone" };
      if (!claimable.lines.some((line) => line.id === input.lineId)) {
        return { outcome: "line-gone" };
      }

      await transaction.worksheetLine.update({
        where: { id: input.lineId },
        data: {
          description: input.line.description,
          detail: input.line.detail,
          assetId: input.line.assetId,
          quantity: input.line.quantity,
          unit: input.line.unit,
          unitNet: input.line.unitNet,
          vatRatePercent: input.line.vatRatePercent,
          netAmount: input.line.netAmount,
          vatAmount: input.line.vatAmount,
          grossAmount: input.line.grossAmount,
        },
      });

      await this.refreshTotals(transaction, input.versionId);
      return { outcome: "ok", alreadyPresent: false };
    });
  }

  /**
   * Egy sor törlése, a maradék újraszámozásával.
   *
   * Az újraszámozás nem kozmetika: a sorszám a kinyomtatott lapon látszik,
   * és egy lyuk a számozásban az ügyfélnek úgy néz ki, mintha eltűnt volna
   * egy tétel.
   *
   * Hiányzó sor esetén nem hibázik: a törlés újraküldése ugyanoda vezet,
   * mint az első - a sor nincs ott.
   */
  async removeLine(input: {
    versionId: string;
    lineId: string;
  }): Promise<WorksheetLineWriteResult> {
    return this.database.$transaction(async (transaction) => {
      const claimable = await this.draftLines(transaction, input.versionId);
      if (!claimable) return { outcome: "version-gone" };
      if (!claimable.lines.some((line) => line.id === input.lineId)) {
        return { outcome: "ok", alreadyPresent: true };
      }

      await transaction.worksheetLine.delete({ where: { id: input.lineId } });

      const remaining = claimable.lines
        .filter((line) => line.id !== input.lineId)
        .sort((a, b) => a.position - b.position);
      // Ideiglenes negatív sorszámokon át, mert a (verzió, sorszám) páros
      // egyedi: közvetlenül lefelé tolva a második sor beleütközne az
      // elsőbe, mielőtt az elmozdulna.
      for (const [index, line] of remaining.entries()) {
        if (line.position !== index + 1) {
          await transaction.worksheetLine.update({
            where: { id: line.id },
            data: { position: -(index + 1) },
          });
        }
      }
      for (const [index, line] of remaining.entries()) {
        if (line.position !== index + 1) {
          await transaction.worksheetLine.update({
            where: { id: line.id },
            data: { position: index + 1 },
          });
        }
      }

      await this.refreshTotals(transaction, input.versionId);
      return { outcome: "ok", alreadyPresent: false };
    });
  }

  /** A piszkozat sorai, zárolható állapotban. `null`, ha a verzió eltűnt
   * vagy már nem piszkozat - azt a hívó konfliktusnak fordítja. */
  private async draftLines(
    transaction: TransactionClient,
    versionId: string,
  ): Promise<{ lines: { id: string; position: number }[] } | null> {
    const version = await transaction.worksheetVersion.findFirst({
      where: { id: versionId, status: "DRAFT" },
      select: {
        lines: {
          select: { id: true, position: true },
          orderBy: { position: "asc" },
        },
      },
    });
    return version ?? null;
  }

  /** A lap összegei a sorokból jönnek, nem a kliensből. Minden sor-művelet
   * után újra kell számolni, különben a fejléc és a tételek elválnak. */
  private async refreshTotals(
    transaction: TransactionClient,
    versionId: string,
  ): Promise<void> {
    const lines = await transaction.worksheetLine.findMany({
      where: { worksheetVersionId: versionId },
      select: { netAmount: true, vatAmount: true, grossAmount: true },
    });
    const totals = sumWorksheetAmounts(lines);
    await transaction.worksheetVersion.update({
      where: { id: versionId },
      data: {
        netAmount: totals.netAmount,
        vatAmount: totals.vatAmount,
        grossAmount: totals.grossAmount,
      },
    });
  }

  /**
   * Az `updatedAt` itt is `(NOW() AT TIME ZONE 'utc')`, nem csupasz `NOW()`:
   * az oszlop időzóna nélküli, és a Prisma UTC-t ír bele, a csupasz `NOW()`
   * viszont a SZERVER időzónájában áll elő. Ezen az egy helyen csak
   * könyvelési időbélyeg múlik rajta (logika nem olvassa), de a két alak
   * együttélése az, amiből egy következő olvasó azt hinné, hogy a csupasz
   * `NOW()` itt rendben van.
   */
  private async allocateSequence(
    transaction: TransactionClient,
    partnerCode: string,
    departmentCode: string,
    year: number,
  ): Promise<number> {
    const rows = await transaction.$queryRaw<Array<{ lastValue: number }>>(
      Prisma.sql`
        INSERT INTO "WorksheetNumberSequence"
          ("id", "partnerCode", "departmentCode", "year", "lastValue", "updatedAt")
        VALUES (${randomUUID()}, ${partnerCode}, ${departmentCode}, ${year}, 1, (NOW() AT TIME ZONE 'utc'))
        ON CONFLICT ("partnerCode", "departmentCode", "year")
        DO UPDATE SET
          "lastValue" = "WorksheetNumberSequence"."lastValue" + 1,
          "updatedAt" = (NOW() AT TIME ZONE 'utc')
        RETURNING "lastValue"
      `,
    );
    const value = rows[0]?.lastValue;
    if (value === undefined) throw new Error("WORKSHEET_SEQUENCE_FAILED");
    return Number(value);
  }
}
