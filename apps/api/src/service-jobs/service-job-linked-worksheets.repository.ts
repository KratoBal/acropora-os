import { Injectable } from "@nestjs/common";
import {
  Prisma,
  prisma,
  type WorksheetVersionStatus,
} from "@acropora/database";

import { collectUnitSubtreeIds } from "../service-assets/unit-subtree.js";
import { buildUnitPaths } from "../service-assets/unit-path.js";
import { assignedUnitIdsFor } from "./assigned-units.query.js";
import {
  LINKABLE_WORKSHEETS_PAGE,
  linkableWorksheetWhere,
} from "./service-job-linked-worksheets.rules.js";

/** The worksheet columns every list needs: the number, the latest version's subject and status, the location, and where it lives. */
const WORKSHEET_LIST_SELECT = {
  id: true,
  number: true,
  createdAt: true,
  handedOverAt: true,
  departmentId: true,
  serviceJob: { select: { jobNumber: true } },
  versions: {
    orderBy: { version: "desc" },
    take: 1,
    select: { subject: true, status: true },
  },
} satisfies Prisma.WorksheetSelect;

type WorksheetListRow = Prisma.WorksheetGetPayload<{
  select: typeof WORKSHEET_LIST_SELECT;
}>;

export interface LinkedWorksheetRow {
  worksheetId: string;
  number: string | null;
  subject: string;
  createdAt: Date;
  handedOverAt: Date | null;
  status: WorksheetVersionStatus;
  departmentPath: string[] | null;
  homeJobNumber: string | null;
  linkedAt: Date;
  linkedByName: string | null;
}

export interface LinkableWorksheetRow {
  worksheetId: string;
  number: string | null;
  subject: string;
  createdAt: Date;
  status: WorksheetVersionStatus;
  departmentPath: string[] | null;
  homeJobNumber: string | null;
  inSameLocation: boolean;
}

@Injectable()
export class ServiceJobLinkedWorksheetsRepository {
  private readonly database = prisma;

  async assignedUnitIds(userId: string): Promise<string[]> {
    return assignedUnitIdsFor(userId);
  }

  /** The job, if the caller may see it (`visibility` is the same filter the detail page uses); `null` otherwise. */
  async jobState(id: string, visibility: Prisma.ServiceJobWhereInput) {
    return this.database.serviceJob.findFirst({
      where: { AND: [{ id }, visibility] },
      select: {
        id: true,
        kind: true,
        customerId: true,
        departmentId: true,
        jobNumber: true,
      },
    });
  }

  /** What the link rules and the event note need about one worksheet. */
  async worksheetState(id: string) {
    const row = await this.database.worksheet.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        customerId: true,
        serviceJobId: true,
        hiddenAt: true,
        linkedToJob: { select: { serviceJobId: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { subject: true },
        },
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      number: row.number,
      customerId: row.customerId,
      serviceJobId: row.serviceJobId,
      hidden: row.hiddenAt !== null,
      linkedToJobId: row.linkedToJob?.serviceJobId ?? null,
      subject: row.versions[0]?.subject ?? "",
    };
  }

  /** Every unit row of one customer, once per request: the paths and the subtree both read it. */
  private async unitRows(customerId: string) {
    return this.database.worksheetDepartment.findMany({
      where: { customerId },
      select: { id: true, name: true, parentId: true },
    });
  }

  /**
   * THE LINKED WORKSHEETS, newest link last (the order they were added). `scope` is the same unit rule the worksheet list and
   * PDF use (`worksheetUnitWhere`): a partner restricted to some units never sees a linked worksheet of another unit.
   */
  async listLinked(
    jobId: string,
    customerId: string | null,
    scope: Prisma.WorksheetWhereInput,
  ): Promise<LinkedWorksheetRow[]> {
    const links = await this.database.serviceJobLinkedWorksheet.findMany({
      where: { serviceJobId: jobId, worksheet: scope },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        createdAt: true,
        linkedById: true,
        worksheet: { select: WORKSHEET_LIST_SELECT },
      },
    });
    if (links.length === 0) return [];
    const paths = customerId
      ? buildUnitPaths(await this.unitRows(customerId))
      : new Map<string, string[]>();
    const actorIds = [
      ...new Set(links.flatMap((l) => (l.linkedById ? [l.linkedById] : []))),
    ];
    const actors = actorIds.length
      ? await this.database.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const nameOf = new Map(actors.map((a) => [a.id, a.displayName]));
    return links.map((link) => ({
      ...shape(link.worksheet, paths),
      linkedAt: link.createdAt,
      linkedByName: link.linkedById
        ? (nameOf.get(link.linkedById) ?? null)
        : null,
    }));
  }

  /** The link log of one sheet, oldest first: who linked or unlinked which worksheet. */
  async history(jobId: string) {
    return this.database.serviceJobEvent.findMany({
      where: {
        serviceJobId: jobId,
        kind: { in: ["WORKSHEET_LINKED", "WORKSHEET_UNLINKED"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        worksheetId: true,
        note: true,
        createdAt: true,
        actor: { select: { displayName: true } },
      },
    });
  }

  /**
   * THE PICKER'S ROWS: the customer's worksheets in the sheet's own location (and every unit below it) first, then any other of
   * the customer's worksheets, so a worksheet of a neighbouring location is still choosable by hand. Two queries instead of
   * one sorted page: a single "newest 50" would push an older same-location worksheet out of the page behind newer
   * worksheets of other locations, and the rows that matter most would be the ones missing.
   */
  async linkable(input: {
    jobId: string;
    customerId: string;
    departmentId: string;
    search: Prisma.WorksheetWhereInput;
  }): Promise<{ rows: LinkableWorksheetRow[]; truncated: boolean }> {
    const units = await this.unitRows(input.customerId);
    const here = collectUnitSubtreeIds(units, input.departmentId);
    const paths = buildUnitPaths(units);
    const base: Prisma.WorksheetWhereInput = {
      AND: [
        linkableWorksheetWhere({
          jobId: input.jobId,
          customerId: input.customerId,
        }),
        input.search,
      ],
    };
    const order = [{ createdAt: "desc" }, { id: "desc" }] as const;
    const take = LINKABLE_WORKSHEETS_PAGE + 1;
    const near = await this.database.worksheet.findMany({
      where: { AND: [base, { departmentId: { in: here } }] },
      orderBy: [...order],
      take,
      select: WORKSHEET_LIST_SELECT,
    });
    const nearShown = near.slice(0, LINKABLE_WORKSHEETS_PAGE);
    const room = LINKABLE_WORKSHEETS_PAGE - nearShown.length;
    // The page is already full of same-location rows: the other locations are not even asked for (the picker says "narrow it").
    const far =
      room > 0
        ? await this.database.worksheet.findMany({
            where: { AND: [base, { departmentId: { notIn: here } }] },
            orderBy: [...order],
            take: room + 1,
            select: WORKSHEET_LIST_SELECT,
          })
        : [];
    const farShown = far.slice(0, Math.max(room, 0));
    return {
      rows: [
        ...nearShown.map((w) => ({
          ...candidate(w, paths),
          inSameLocation: true,
        })),
        ...farShown.map((w) => ({
          ...candidate(w, paths),
          inSameLocation: false,
        })),
      ],
      truncated: near.length === take || far.length > farShown.length,
    };
  }

  /**
   * THE LINK AND ITS LOG ENTRY IN ONE TRANSACTION: a link without its entry would be a change with no trace, and an entry
   * without its link a claim that never happened. The unique `worksheetId` is the last line of defence against two people
   * linking the same worksheet to two sheets at once: the loser gets `duplicate`, not a half-written state.
   */
  async link(input: {
    jobId: string;
    worksheetId: string;
    actorUserId: string;
    note: string;
  }): Promise<{ ok: true } | { ok: false; reason: "duplicate" }> {
    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.serviceJobLinkedWorksheet.create({
          data: {
            serviceJobId: input.jobId,
            worksheetId: input.worksheetId,
            linkedById: input.actorUserId,
          },
        });
        await transaction.serviceJobEvent.create({
          data: {
            serviceJobId: input.jobId,
            kind: "WORKSHEET_LINKED",
            worksheetId: input.worksheetId,
            note: input.note,
            actorUserId: input.actorUserId,
          },
        });
      });
      return { ok: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { ok: false, reason: "duplicate" };
      throw error;
    }
  }

  /** The unlink and its log entry in one transaction; `gone` when the link was removed meanwhile (nothing written, no entry). */
  async unlink(input: {
    jobId: string;
    worksheetId: string;
    actorUserId: string;
    note: string;
  }): Promise<{ ok: true } | { ok: false; reason: "gone" }> {
    return this.database.$transaction(async (transaction) => {
      const removed = await transaction.serviceJobLinkedWorksheet.deleteMany({
        where: { serviceJobId: input.jobId, worksheetId: input.worksheetId },
      });
      if (removed.count !== 1) return { ok: false, reason: "gone" } as const;
      await transaction.serviceJobEvent.create({
        data: {
          serviceJobId: input.jobId,
          kind: "WORKSHEET_UNLINKED",
          worksheetId: input.worksheetId,
          note: input.note,
          actorUserId: input.actorUserId,
        },
      });
      return { ok: true } as const;
    });
  }
}

function candidate(row: WorksheetListRow, paths: Map<string, string[]>) {
  const shaped = shape(row, paths);
  return {
    worksheetId: shaped.worksheetId,
    number: shaped.number,
    subject: shaped.subject,
    createdAt: shaped.createdAt,
    status: shaped.status,
    departmentPath: shaped.departmentPath,
    homeJobNumber: shaped.homeJobNumber,
  };
}

function shape(row: WorksheetListRow, paths: Map<string, string[]>) {
  return {
    worksheetId: row.id,
    number: row.number,
    // A worksheet without a version cannot come out of the service (it is created with its first one); the read still must
    // not throw on one: it reads as an empty draft, like the job detail does.
    subject: row.versions[0]?.subject ?? "",
    createdAt: row.createdAt,
    handedOverAt: row.handedOverAt,
    status: (row.versions[0]?.status ?? "DRAFT") as WorksheetVersionStatus,
    departmentPath: paths.get(row.departmentId) ?? null,
    homeJobNumber: row.serviceJob?.jobNumber ?? null,
  };
}
