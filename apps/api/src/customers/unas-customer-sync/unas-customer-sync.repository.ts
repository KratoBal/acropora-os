import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma, Repository } from "@acropora/database";
import type {
  UnasApiCustomer,
  UnasApiCustomerAddress,
  UnasCustomerSyncRun,
  UnasCustomerSyncSummary,
} from "@acropora/types";

import { generateCode } from "../../common/code-generator.util.js";

const ACTIVE_SYNC_KEY = "UNAS_CUSTOMERS";
const EXTERNAL_ENTITY_TYPE = "Customer";
const STALE_RUN_AFTER_MS = 15 * 60_000;

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function toRunView(run: {
  id: string;
  status: string;
  windowStart: Date | null;
  windowEnd: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  customersSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCode: string | null;
}): UnasCustomerSyncRun {
  return {
    id: run.id,
    status: run.status as UnasCustomerSyncRun["status"],
    windowStart: run.windowStart?.toISOString() ?? null,
    windowEnd: run.windowEnd.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    customersSeen: run.customersSeen,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    unchangedCount: run.unchangedCount,
    errorCode: run.errorCode,
  };
}

/// A vásárló azonosított állapotát (displayName, type, cím, hash) leíró
/// belső projekció - a canonicalHash dönti el, hogy a beérkezett UNAS sor
/// tényleges változást hordoz-e (UPDATE) vagy sem (UNCHANGED), a
/// UnasProductSyncDiffEngine kanonikus-hash mintáját követve, jóval
/// egyszerűbb formában.
interface CanonicalCustomer {
  type: "PERSON" | "COMPANY";
  displayName: string;
  email: string | null;
  phone: string | null;
  billing: AddressInput | null;
  shipping: AddressInput | null;
}

interface AddressInput {
  type: "BILLING" | "SHIPPING";
  name: string | null;
  country: string;
  postalCode: string;
  city: string;
  line1: string;
}

function customerType(address: UnasApiCustomerAddress | null): "PERSON" | "COMPANY" {
  return address?.customerType === "company" ? "COMPANY" : "PERSON";
}

/// Csak akkor épít cím rekordot, ha az irányítószám, város és utca mind
/// jelen van - a CustomerAddress modellen ezek kötelező mezők, üresen
/// hagyott UNAS mezőkből nem hozunk létre hiányos, "szemét" cím sort.
function toAddressInput(
  type: "BILLING" | "SHIPPING",
  address: UnasApiCustomerAddress | null,
): AddressInput | null {
  if (!address) return null;
  const postalCode = address.zip?.trim();
  const city = address.city?.trim();
  const line1 = address.street?.trim();
  if (!postalCode || !city || !line1) return null;
  return {
    type,
    name: address.name?.trim() || null,
    country: address.countryCode?.trim() || address.country?.trim() || "HU",
    postalCode,
    city,
    line1,
  };
}

function toCanonical(customer: UnasApiCustomer): CanonicalCustomer {
  const displayName =
    customer.contactName?.trim() ||
    customer.invoiceAddress?.name?.trim() ||
    customer.shippingAddress?.name?.trim() ||
    `UNAS vásárló #${customer.externalId}`;
  return {
    type: customerType(customer.invoiceAddress ?? customer.shippingAddress),
    displayName,
    email: customer.email?.trim() || null,
    phone: customer.contactPhone?.trim() || customer.contactMobile?.trim() || null,
    billing: toAddressInput("BILLING", customer.invoiceAddress),
    shipping: toAddressInput("SHIPPING", customer.shippingAddress),
  };
}

export interface UnasCustomerSyncApplyResult extends UnasCustomerSyncSummary {}

@Injectable()
export class UnasCustomerSyncRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async getCursor(): Promise<Date | null> {
    const cursor = await prisma.integrationCursor.findUnique({
      where: { provider_stream: { provider: "UNAS", stream: "CUSTOMERS" } },
    });
    return cursor?.lastSuccessfulWindowEnd ?? null;
  }

  async createRun(input: {
    windowStart: Date | null;
    windowEnd: Date;
  }): Promise<string> {
    try {
      const run = await prisma.$transaction(async (tx) => {
        await tx.unasCustomerSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "UNAS_CUSTOMER_SYNC_STALE",
          },
        });
        return tx.unasCustomerSyncRun.create({
          data: {
            ...input,
            activeKey: ACTIVE_SYNC_KEY,
            status: "RUNNING",
            startedAt: new Date(),
          },
        });
      });
      return run.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("UNAS_CUSTOMER_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }

  async markFailed(runId: string, errorCode: string): Promise<void> {
    await prisma.unasCustomerSyncRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        activeKey: null,
        status: "FAILED",
        completedAt: new Date(),
        errorCode: errorCode.slice(0, 200),
      },
    });
  }

  async getRun(runId: string): Promise<UnasCustomerSyncRun> {
    const run = await prisma.unasCustomerSyncRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException("UNAS_CUSTOMER_SYNC_RUN_NOT_FOUND");
    return toRunView(run);
  }

  async listRuns(limit: number): Promise<UnasCustomerSyncRun[]> {
    const runs = await prisma.unasCustomerSyncRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return runs.map(toRunView);
  }

  /// Idempotensen alkalmaz egy UNAS vásárló-lapot: új Customer.Id-hez új
  /// Customer + cím rekordok jönnek létre; ismert Id-nál a kanonikus hash
  /// eltérése esetén frissül a törzsadat és a BILLING/SHIPPING cím (az OTHER
  /// típusú, kézzel felvitt címek érintetlenek maradnak); egyezés esetén
  /// nincs írás.
  async apply(
    runId: string,
    customers: readonly UnasApiCustomer[],
    windowStart: Date | null,
    windowEnd: Date,
  ): Promise<UnasCustomerSyncApplyResult> {
    return prisma.$transaction(
      async (tx) => {
        const run = await tx.unasCustomerSyncRun.findUniqueOrThrow({
          where: { id: runId },
        });
        if (run.status !== "RUNNING")
          throw new Error(`INVALID_CUSTOMER_SYNC_RUN_STATE:${run.status}`);

        let createdCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;

        for (const customer of customers) {
          const canonical = toCanonical(customer);
          const canonicalHash = JSON.stringify(canonical);
          const reference = await tx.externalReference.findUnique({
            where: {
              system_entityType_externalId: {
                system: "UNAS",
                entityType: EXTERNAL_ENTITY_TYPE,
                externalId: customer.externalId,
              },
            },
          });

          if (!reference) {
            const created = await tx.customer.create({
              data: {
                customerNumber: generateCode("VEVO"),
                type: canonical.type,
                displayName: canonical.displayName,
                email: canonical.email,
                phone: canonical.phone,
                addresses: {
                  create: [canonical.billing, canonical.shipping]
                    .filter((address): address is AddressInput => Boolean(address))
                    .map((address, index) => ({
                      type: address.type,
                      name: address.name,
                      country: address.country,
                      postalCode: address.postalCode,
                      city: address.city,
                      line1: address.line1,
                      isDefault: index === 0,
                    })),
                },
              },
            });
            await tx.externalReference.create({
              data: {
                system: "UNAS",
                entityType: EXTERNAL_ENTITY_TYPE,
                entityId: created.id,
                externalId: customer.externalId,
                metadata: json({ hash: canonicalHash }),
                lastSyncedAt: windowEnd,
              },
            });
            createdCount += 1;
            continue;
          }

          const previousHash = (reference.metadata as { hash?: string } | null)
            ?.hash;
          if (previousHash === canonicalHash) {
            await tx.externalReference.update({
              where: { id: reference.id },
              data: { lastSyncedAt: windowEnd },
            });
            unchangedCount += 1;
            continue;
          }

          await tx.customer.update({
            where: { id: reference.entityId },
            data: {
              type: canonical.type,
              displayName: canonical.displayName,
              email: canonical.email,
              phone: canonical.phone,
            },
          });
          await tx.customerAddress.deleteMany({
            where: {
              customerId: reference.entityId,
              type: { in: ["BILLING", "SHIPPING"] },
            },
          });
          const addresses = [canonical.billing, canonical.shipping].filter(
            (address): address is AddressInput => Boolean(address),
          );
          if (addresses.length > 0)
            await tx.customerAddress.createMany({
              data: addresses.map((address, index) => ({
                customerId: reference.entityId,
                type: address.type,
                name: address.name,
                country: address.country,
                postalCode: address.postalCode,
                city: address.city,
                line1: address.line1,
                isDefault: index === 0,
              })),
            });
          await tx.externalReference.update({
            where: { id: reference.id },
            data: {
              metadata: json({ hash: canonicalHash }),
              lastSyncedAt: windowEnd,
            },
          });
          updatedCount += 1;
        }

        await tx.integrationCursor.upsert({
          where: { provider_stream: { provider: "UNAS", stream: "CUSTOMERS" } },
          create: {
            provider: "UNAS",
            stream: "CUSTOMERS",
            lastSuccessfulWindowEnd: windowEnd,
          },
          update: { lastSuccessfulWindowEnd: windowEnd },
        });
        await tx.unasCustomerSyncRun.update({
          where: { id: runId },
          data: {
            activeKey: null,
            status: "APPLIED",
            completedAt: new Date(),
            customersSeen: customers.length,
            createdCount,
            updatedCount,
            unchangedCount,
          },
        });

        return {
          runId,
          status: "APPLIED" as const,
          customersSeen: customers.length,
          createdCount,
          updatedCount,
          unchangedCount,
          windowStart: windowStart?.toISOString() ?? null,
          windowEnd: windowEnd.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
      },
    );
  }
}
