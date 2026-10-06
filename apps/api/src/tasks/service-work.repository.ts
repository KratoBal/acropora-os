import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

/**
 * A SZERVIZES SAJÁT HIBAJEGYEI ÉS MUNKALAPJAI a Feladataim oldalhoz (kártya
 * 041a3dd5). A kiosztás a `ServiceJobAssignee` és a `WorksheetAssignee`
 * táblán áll; a jegy `assignedUserId` oszlopa halott (lásd
 * `service-job-list-scope.ts`, a `mine` hatókör jegyzete). Rejtett tétel nem
 * jön.
 */
const JOB_CLOSED = ["COMPLETED", "CANCELLED"] as const;

/** A lezárt nézet ennyit mutat, a legújabbtól; a nyitott mind jön. */
export const SERVICE_WORK_CLOSED_LIMIT = 100;

const jobSelect = {
  id: true,
  jobNumber: true,
  status: true,
  title: true,
  scheduledAt: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  department: { select: { name: true } },
} satisfies Prisma.ServiceJobSelect;

const worksheetSelect = {
  id: true,
  number: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  department: { select: { name: true } },
  versions: {
    orderBy: { version: "desc" },
    take: 1,
    select: {
      status: true,
      sentForSignatureAt: true,
      _count: { select: { lines: true } },
    },
  },
} satisfies Prisma.WorksheetSelect;

export type ServiceWorkJobRow = Prisma.ServiceJobGetPayload<{
  select: typeof jobSelect;
}>;
export type ServiceWorkWorksheetRow = Prisma.WorksheetGetPayload<{
  select: typeof worksheetSelect;
}>;

@Injectable()
export class ServiceWorkRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /** A rám osztott, nem rejtett hibajegyek; nyitott vagy lezárt. */
  jobs(userId: string, closed: boolean): Promise<ServiceWorkJobRow[]> {
    return this.database.serviceJob.findMany({
      where: {
        hiddenAt: null,
        assignees: { some: { userId } },
        status: closed ? { in: [...JOB_CLOSED] } : { notIn: [...JOB_CLOSED] },
      },
      select: jobSelect,
      orderBy: { createdAt: closed ? "desc" : "asc" },
      ...(closed ? { take: SERVICE_WORK_CLOSED_LIMIT } : {}),
    });
  }

  /**
   * A rám osztott, nem rejtett munkalapok a legutolsó változatukkal. Az
   * állapot a változaton áll, ezért a nyitott és a lezárt szétválogatása a
   * szolgáltatásban történik.
   */
  worksheets(userId: string): Promise<ServiceWorkWorksheetRow[]> {
    return this.database.worksheet.findMany({
      where: { hiddenAt: null, assignees: { some: { userId } } },
      select: worksheetSelect,
      orderBy: { createdAt: "asc" },
    });
  }
}
