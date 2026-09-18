import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import { unitPathFor } from "../common/unit-path-lookup.js";

@Injectable()
export class ServiceJobPackageRepository {
  private readonly database = prisma;

  async packageData(id: string, visibility: Prisma.ServiceJobWhereInput) {
    const job = await this.database.serviceJob.findFirst({
      where: { AND: [{ id }, visibility] },
      select: {
        id: true,
        jobNumber: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        departmentId: true,
        customer: { select: { displayName: true } },
        events: {
          where: { kind: "STATUS_CHANGE" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, createdAt: true, toStatus: true, note: true },
        },
        assets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { asset: { select: { assetNumber: true, name: true } } },
        },
        assignees: {
          orderBy: [{ assignedAt: "asc" }, { userId: "asc" }],
          select: { user: { select: { displayName: true, nickname: true } } },
        },
        worksheets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            hiddenAt: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { id: true },
            },
            documents: {
              where: { type: "GENERATED_SHEET" },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: {
                id: true,
                worksheetVersionId: true,
                fileName: true,
                contentType: true,
                content: true,
                storageKey: true,
              },
            },
          },
        },
      },
    });
    if (!job) return null;
    return {
      ...job,
      departmentPath: await unitPathFor(this.database, job.departmentId),
    };
  }

  assignedUnitIds(userId: string) {
    return this.database.userWorksheetDepartment
      .findMany({ where: { userId }, select: { departmentId: true } })
      .then((rows) => rows.map((row) => row.departmentId));
  }
}
