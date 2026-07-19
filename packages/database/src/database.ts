import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  acroporaPrisma?: PrismaClient;
};

/**
 * Egyetlen megosztott PrismaClient példány. Fejlesztői hot reload során a
 * globalThis tárolja, productionben pedig a modul singleton viselkedése elég.
 */
export const prisma = globalForPrisma.acroporaPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.acroporaPrisma = prisma;
}

export type DatabaseClient = PrismaClient;
