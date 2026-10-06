import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  type AuthenticatedUser,
  type MyServiceWorkItem,
  type MyServiceWorkResponse,
  type MyServiceWorkView,
  serviceJobOverdueSince,
  serviceJobWorkBucket,
  sortMyServiceWork,
  worksheetDisplayStatus,
  worksheetWorkBucket,
} from "@acropora/types";

import { startOfBudapestDay } from "../dashboard/budapest-day.js";
import {
  SERVICE_WORK_CLOSED_LIMIT,
  ServiceWorkRepository,
  type ServiceWorkJobRow,
  type ServiceWorkWorksheetRow,
} from "./service-work.repository.js";

/**
 * A FELADATAIM A SZERVIZES SZEMSZÖGÉBŐL (kártya 041a3dd5; Balázs 2026-09-02,
 * „2.”). A besorolás a `@acropora/types` tiszta függvényeiben áll; itt csak a
 * mai és a holnapi nap kezdete (Budapest) és a sorok alakítása.
 */
@Injectable()
export class ServiceWorkService {
  constructor(private readonly repository: ServiceWorkRepository) {}

  async list(
    user: AuthenticatedUser,
    view: MyServiceWorkView,
    now = new Date(),
  ): Promise<MyServiceWorkResponse> {
    // a partnerfiók nem szervizes: ez a lap a belső kiosztásról szól
    if (user.customerId || user.supplierId)
      throw new ForbiddenException("Ez a nézet belső szervizeseknek szól.");
    const todayStart = startOfBudapestDay(now);
    const tomorrowStart = startOfBudapestDay(now, 1);

    const [openJobs, closedJobs, worksheets] = await Promise.all([
      this.repository.jobs(user.id, false),
      view === "CLOSED"
        ? this.repository.jobs(user.id, true)
        : Promise.resolve([]),
      this.repository.worksheets(user.id),
    ]);

    const items = [
      ...openJobs.map((row) => job(row, todayStart, tomorrowStart)),
      ...closedJobs.map((row) => job(row, todayStart, tomorrowStart)),
      ...worksheets.flatMap((row) => worksheet(row)),
    ];
    const open = items.filter((item) => item.bucket !== "CLOSED");
    const closed = sortMyServiceWork(
      items.filter((item) => item.bucket === "CLOSED"),
      "CLOSED",
    ).slice(0, SERVICE_WORK_CLOSED_LIMIT);

    return {
      view,
      mine:
        view === "OPEN"
          ? sortMyServiceWork(
              open.filter((item) => item.bucket === "MINE"),
              "MINE",
            )
          : [],
      others:
        view === "OPEN"
          ? sortMyServiceWork(
              open.filter((item) => item.bucket === "OTHERS"),
              "OTHERS",
            )
          : [],
      closed: view === "CLOSED" ? closed : [],
      openCount: open.length,
    };
  }
}

function job(
  row: ServiceWorkJobRow,
  todayStart: Date,
  tomorrowStart: Date,
): MyServiceWorkItem {
  const overdue = serviceJobOverdueSince({
    status: row.status,
    scheduledAt: row.scheduledAt,
    todayStart,
  });
  return {
    kind: "SERVICE_JOB",
    id: row.id,
    number: row.jobNumber,
    status: row.status,
    title: row.title,
    partnerName: row.customer?.displayName ?? null,
    unitName: row.department?.name ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    overdueSince: overdue?.toISOString() ?? null,
    sentForSignature: false,
    bucket: serviceJobWorkBucket({
      status: row.status,
      scheduledAt: row.scheduledAt,
      tomorrowStart,
    }),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Változat nélküli munkalap nincs a listán: nincs állapota, amiről szólna. */
function worksheet(row: ServiceWorkWorksheetRow): MyServiceWorkItem[] {
  const version = row.versions[0];
  if (!version) return [];
  const sentForSignature = version.sentForSignatureAt !== null;
  return [
    {
      kind: "WORKSHEET",
      id: row.id,
      number: row.number,
      status: worksheetDisplayStatus(version.status, version._count.lines),
      title: null,
      partnerName: row.customer.displayName,
      unitName: row.department.name,
      scheduledAt: null,
      // feladat-határidő nincs: a változat `dueDate` mezője fizetési határidő
      overdueSince: null,
      sentForSignature,
      bucket: worksheetWorkBucket({ status: version.status, sentForSignature }),
      createdAt: row.createdAt.toISOString(),
    },
  ];
}
