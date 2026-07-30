import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProjectRepository,
  type ProjectDatabase,
} from "./project.repository.js";

function buildDatabase() {
  const events: unknown[] = [];
  const projects: Array<{
    id: string;
    projectNumber: string;
    name: string;
    status: "ACTIVE";
  }> = [];
  let sequence = 0n;

  const database: ProjectDatabase = {
    project: {
      findMany: async () => projects,
    },
    $transaction: async (operation) =>
      operation({
        $queryRaw: async <T>() => {
          sequence += 1n;
          return [{ value: sequence }] as T;
        },
        project: {
          create: async (args: unknown) => {
            const data = (
              args as {
                data: {
                  projectNumber: string;
                  name: string;
                  status: "ACTIVE";
                };
              }
            ).data;
            const project = {
              id: `project-${projects.length + 1}`,
              projectNumber: data.projectNumber,
              name: data.name,
              status: data.status,
            };
            projects.push(project);
            return project;
          },
        },
        domainEvent: {
          create: async (args: unknown) => {
            events.push(args);
            return {};
          },
        },
      }),
  };

  return { database, projects, events };
}

describe("ProjectRepository", () => {
  it("creates concurrent-safe human-readable project numbers and an audit event", async () => {
    const fake = buildDatabase();
    const repository = new ProjectRepository(fake.database);

    const first = await repository.create("Első projekt", "user-1");
    const second = await repository.create("Második projekt", "user-1");

    assert.equal(first.projectNumber, "PRJ-000001");
    assert.equal(second.projectNumber, "PRJ-000002");
    assert.equal(fake.projects.length, 2);
    assert.equal(fake.events.length, 2);
  });

  it("returns assignable projects as lightweight options", async () => {
    const fake = buildDatabase();
    const repository = new ProjectRepository(fake.database);
    await repository.create("Akvárium építés", "user-1");

    const result = await repository.listAssignable();

    assert.deepEqual(result, [
      {
        id: "project-1",
        projectNumber: "PRJ-000001",
        name: "Akvárium építés",
        status: "ACTIVE",
      },
    ]);
  });
});
