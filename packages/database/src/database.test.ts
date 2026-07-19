import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "./database.js";
import { checkDatabaseHealth } from "./database-health.js";

describe("Prisma runtime", () => {
  it("exports the same singleton from repeated module access", async () => {
    const secondImport = await import("./database.js");
    assert.equal(secondImport.prisma, prisma);
  });
});

describe("database health", () => {
  it("returns ok when SELECT 1 succeeds", async () => {
    const client = {
      $queryRaw: async () => [{ "?column?": 1 }],
    } as unknown as Pick<PrismaClient, "$queryRaw">;

    const result = await checkDatabaseHealth(client);
    assert.equal(result.status, "ok");
    assert.ok(result.latencyMs >= 0);
  });

  it("returns unavailable instead of throwing", async () => {
    const client = {
      $queryRaw: async () => {
        throw new Error("connection refused");
      },
    } as unknown as Pick<PrismaClient, "$queryRaw">;

    const result = await checkDatabaseHealth(client);
    assert.equal(result.status, "unavailable");
    assert.match(result.error ?? "", /connection refused/);
  });
});
