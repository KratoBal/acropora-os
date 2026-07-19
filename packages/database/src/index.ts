export { Prisma, PrismaClient } from "@prisma/client";
export type {
  AuditLog,
  Category,
  Manufacturer,
  Session,
  User,
  UserRole,
} from "@prisma/client";

export { prisma } from "./database.js";
export type { DatabaseClient } from "./database.js";
export { checkDatabaseHealth } from "./database-health.js";
export type {
  DatabaseHealth,
  DatabaseHealthClient,
} from "./database-health.js";
export { Repository } from "./repository.js";
export { seedCategories, seedManufacturers, seedUsers } from "./seed-data.js";
