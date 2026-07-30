import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { ProjectOption } from "@acropora/types";

interface ProjectRow {
  id: string;
  projectNumber: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
}

interface ProjectTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  project: {
    create(args: unknown): Promise<ProjectRow>;
  };
  domainEvent: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface ProjectDatabase {
  project: {
    findMany(args: unknown): Promise<ProjectRow[]>;
  };
  $transaction<T>(
    operation: (transaction: ProjectTransaction) => Promise<T>,
  ): Promise<T>;
}

export const PROJECT_DATABASE = Symbol("PROJECT_DATABASE");

function toOption(project: ProjectRow): ProjectOption {
  return {
    id: project.id,
    projectNumber: project.projectNumber,
    name: project.name,
    status: project.status,
  };
}

function formatProjectNumber(value: bigint): string {
  return `PRJ-${value.toString().padStart(6, "0")}`;
}

@Injectable()
export class ProjectRepository extends Repository {
  private readonly projectDatabase: ProjectDatabase;

  constructor(
    @Optional() @Inject(PROJECT_DATABASE) projectDatabase?: ProjectDatabase,
  ) {
    super(prisma);
    this.projectDatabase =
      projectDatabase ?? (prisma as unknown as ProjectDatabase);
  }

  async listAssignable(): Promise<ProjectOption[]> {
    const projects = await this.projectDatabase.project.findMany({
      where: { status: { in: ["DRAFT", "ACTIVE", "ON_HOLD"] } },
      select: {
        id: true,
        projectNumber: true,
        name: true,
        status: true,
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return projects.map(toOption);
  }

  async create(name: string, actorUserId: string): Promise<ProjectOption> {
    return this.projectDatabase.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ value: bigint }>>(
        Prisma.sql`SELECT nextval('"ProjectNumberSequence"') AS value`,
      );
      const value = rows[0]?.value;
      if (value === undefined)
        throw new Error("PROJECT_NUMBER_SEQUENCE_FAILED");

      const project = await transaction.project.create({
        data: {
          projectNumber: formatProjectNumber(value),
          name,
          status: "ACTIVE",
          createdById: actorUserId,
        },
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
        },
      });

      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "project.created",
          aggregateType: "Project",
          aggregateId: project.id,
          actorUserId,
          payload: {
            projectNumber: project.projectNumber,
            name: project.name,
          },
          occurredAt: new Date(),
          schemaVersion: 1,
        },
      });

      return toOption(project);
    });
  }
}
