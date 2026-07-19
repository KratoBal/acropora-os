export { Prisma, PrismaClient } from "@prisma/client";
export type {
  AuditLog,
  Aquarium,
  AquariumMeasurement,
  Brand,
  Category,
  ChannelListing,
  Customer,
  CustomerAddress,
  DomainEvent,
  ExternalReference,
  GoodsReceipt,
  GoodsReceiptLine,
  IcpReport,
  IcpResult,
  Product,
  ProductCategory,
  ProductImage,
  ProductRelation,
  ProductVariant,
  PurchaseOrder,
  PurchaseOrderLine,
  SalesOrder,
  SalesOrderLine,
  ServiceJob,
  Session,
  StockMovement,
  StockMovementLine,
  Supplier,
  SupplierProduct,
  User,
  UserRole,
  Warehouse,
  WarehouseLocation,
} from "@prisma/client";

export { prisma } from "./database.js";
export type { DatabaseClient } from "./database.js";
export { checkDatabaseHealth } from "./database-health.js";
export type {
  DatabaseHealth,
  DatabaseHealthClient,
} from "./database-health.js";
export { Repository } from "./repository.js";
export { seedBrands, seedCategories, seedUsers } from "./seed-data.js";
