import type { PrismaClient } from "@prisma/client";

import { prisma } from "./database.js";

export interface DatabaseHealth {
  status: "ok" | "unavailable";
  latencyMs: number;
  error?: string;
}

export type DatabaseHealthClient = Pick<PrismaClient, "$queryRaw">;

export async function checkDatabaseHealth(
  client: DatabaseHealthClient = prisma,
): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    await client.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      status: "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      error:
        error instanceof Error ? error.message : "Ismeretlen adatbázishiba.",
    };
  }
}
