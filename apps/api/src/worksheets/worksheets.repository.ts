import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  WorksheetListResponse,
} from "@acropora/types";

import type {
  CreateWorksheetDepartmentDto,
  WorksheetListQueryDto,
} from "./dto/worksheet.dto.js";
import type { NormalizedWorksheetContent } from "./worksheet-content.js";
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
} from "./worksheets.types.js";

export type WorksheetCloseFailure =
  "NOT_FOUND" | "NOT_DRAFT" | "NO_LINES" | WorksheetNumberIssue;

export type WorksheetCloseResult =
  { ok: true } | { ok: false; reason: WorksheetCloseFailure };

export type WorksheetAmendResult =
  | { ok: true; version: number }
  | { ok: false; reason: "NOT_FOUND" | "NOT_CLOSED" | "CONCURRENT_VERSION" };

export type WorksheetSignResult =
  { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_AWAITING_SIGNATURE" };

type TransactionClient = Prisma.TransactionClient;

function versionContentData(content: NormalizedWorksheetContent) {
  return {
    subject: content.subject,
    unitText: content.unitText,
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
              ...versionContentData(input.content),
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
      const claimed = await transaction.worksheetVersion.updateMany({
        where: { id: input.versionId, status: "DRAFT" },
        data: versionContentData(input.content),
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

        const version = current.version + 1;
        const created = await transaction.worksheetVersion.create({
          data: {
            worksheetId: worksheet.id,
            version,
            status: "DRAFT",
            changeReason: input.changeReason,
            createdById: input.actorUserId,
            ...versionContentData(input.content),
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
        VALUES (${randomUUID()}, ${partnerCode}, ${departmentCode}, ${year}, 1, NOW())
        ON CONFLICT ("partnerCode", "departmentCode", "year")
        DO UPDATE SET
          "lastValue" = "WorksheetNumberSequence"."lastValue" + 1,
          "updatedAt" = NOW()
        RETURNING "lastValue"
      `,
    );
    const value = rows[0]?.lastValue;
    if (value === undefined) throw new Error("WORKSHEET_SEQUENCE_FAILED");
    return Number(value);
  }
}
