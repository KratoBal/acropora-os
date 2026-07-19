import type { PrismaClient } from "@prisma/client";

import { prisma } from "./database.js";

/** Közös alap az üzleti repositoryk számára. */
export abstract class Repository {
  protected constructor(protected readonly database: PrismaClient = prisma) {}
}
