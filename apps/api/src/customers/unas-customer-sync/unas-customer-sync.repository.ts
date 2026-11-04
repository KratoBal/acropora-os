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
import { retryOnTakenCode } from "../../common/unique-code.util.js";
import {
  emptyBackfillCounts,
  fillIfEmpty,
  mergedFrom,
  unasCustomerFill,
  unasTaxBackfillBucket,
  type UnasCustomerFill,
  type UnasTaxBackfillCounts,
} from "./unas-customer-fill.js";

const ACTIVE_SYNC_KEY = "UNAS_CUSTOMERS";
const EXTERNAL_ENTITY_TYPE = "Customer";
const STALE_RUN_AFTER_MS = 15 * 60_000;

/** The one-time backfill's marker: its counts and the filled ids (a wrong fill stays reversible). */
export const UNAS_TAX_BACKFILL_EVENT_ID = "unas-customer-tax-backfill-20261104";

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
export interface CanonicalCustomer {
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

function customerType(
  address: UnasApiCustomerAddress | null,
): "PERSON" | "COMPANY" {
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

/**
 * WHAT A UNAS UPDATE WRITES ON AN EXISTING CUSTOMER ROW, and nothing else. The tax numbers, the company name, the
 * billing e-mail and the consents are NOT here: a colleague's edit of those on the customer page (acrobot 42510) must
 * survive a sync. (The tax numbers and the company name are only FILLED where the row has none: `unasCustomerFill`.) A spec pins the five keys, so a field added to this write is a red test, not a silent overwrite.
 * (The type, the name, the e-mail, the phone and the BILLING/SHIPPING addresses ARE overwritten when UNAS changes
 * the record; the customer page says so on a UNAS customer.)
 */
export function unasCustomerUpdateData(canonical: CanonicalCustomer) {
  return {
    type: canonical.type,
    displayName: canonical.displayName,
    email: canonical.email,
    phone: canonical.phone,
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
    phone:
      customer.contactPhone?.trim() || customer.contactMobile?.trim() || null,
    billing: toAddressInput("BILLING", customer.invoiceAddress),
    shipping: toAddressInput("SHIPPING", customer.shippingAddress),
  };
}

/**
 * Writes the UNAS values onto the row's EMPTY tax fields only; the fields written, none when the row already has them
 * (or the reference points at no row).
 */
async function fillEmptyFields(
  tx: Prisma.TransactionClient,
  customerId: string,
  fill: UnasCustomerFill,
): Promise<Partial<UnasCustomerFill> | null> {
  const row = await tx.customer.findUnique({
    where: { id: customerId },
    select: { taxNumber: true, euTaxNumber: true, companyName: true },
  });
  if (!row) return null;
  const data = fillIfEmpty(row, fill);
  if (Object.keys(data).length === 0) return null;
  await tx.customer.update({ where: { id: customerId }, data });
  return data;
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
  ///
  /// AZ UJ VEVO SZAMA IDEBENT KESZUL, es ezert all a hivas a burkolatban: egy
  /// ismeretlen UNAS-vevohoz `generateCode("VEVO")` huz szamot, es ket olyan
  /// mentes, amely ugyanabban a masodpercben ugyanazt a veget huzza, ma az
  /// egesz kort elbuktatja. A burkolat nem kap kodot kivulrol: az EGESZ
  /// tranzakciot futtatja ujra, es a huzas magatol ujra megtortenik, minden
  /// erintett vevore kulon.
  ///
  /// AMI AZ UJRAFUTTATAST BIZTONSAGOSSA TESZI, ES AMIERT NEM KELETKEZIK
  /// DUPLIKATUM: az elbukott kiserlet semmit nem hagy maga utan. A futas sora
  /// visszagorgetve ujra RUNNING allapotu, tehat a bevezeto ellenorzes a
  /// masodik kiserletben is atmegy, es a mar ismert UNAS-azonositokat ugyanaz
  /// az `externalReference` keresés talalja meg, mint elsore. A "letrehoz vagy
  /// frissit" dontes tehat minden kiserletben ugyanugy dol el.
  ///
  /// AMIBE KERUL: egy ujrafuttatas a TELJES koteget ujra vegigviszi. Ez igy
  /// helyes, mert a tranzakcio mindent vagy semmit: az elbukott kiserlet utan
  /// nincs felig alkalmazott kotegunk, es az alternativa az, hogy egyetlen
  /// vevoszam-utkozes miatt az egesz kor elvesz.
  async apply(
    runId: string,
    customers: readonly UnasApiCustomer[],
    windowStart: Date | null,
    windowEnd: Date,
  ): Promise<UnasCustomerSyncApplyResult> {
    return retryOnTakenCode({ field: "customerNumber" }, () =>
      prisma.$transaction(
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
                  ...unasCustomerFill(customer),
                  addresses: {
                    create: [canonical.billing, canonical.shipping]
                      .filter((address): address is AddressInput =>
                        Boolean(address),
                      )
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

            // a partner merge moved this reference: the row is the partner register's (murena 42674)
            if (mergedFrom(reference.metadata)) {
              await tx.externalReference.update({
                where: { id: reference.id },
                data: { lastSyncedAt: windowEnd },
              });
              unchangedCount += 1;
              continue;
            }

            // outside the hash: an unchanged UNAS record still fills an empty tax field once
            const filled = await fillEmptyFields(
              tx,
              reference.entityId,
              unasCustomerFill(customer),
            );
            const previousHash = (
              reference.metadata as { hash?: string } | null
            )?.hash;
            if (previousHash === canonicalHash) {
              await tx.externalReference.update({
                where: { id: reference.id },
                data: { lastSyncedAt: windowEnd },
              });
              if (filled) updatedCount += 1;
              else unchangedCount += 1;
              continue;
            }

            await tx.customer.update({
              where: { id: reference.entityId },
              data: unasCustomerUpdateData(canonical),
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
            where: {
              provider_stream: { provider: "UNAS", stream: "CUSTOMERS" },
            },
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
      ),
    );
  }

  /**
   * THE ONE-TIME BACKFILL of the existing rows from a full UNAS pull (acrobot 42670), with the sync's own
   * fill-if-empty rule, in one transaction with its marker event. Null when it already ran. Writes nothing but the
   * empty tax fields and the company name; a merged reference is skipped as in the sync.
   */
  async backfillTaxFields(
    customers: readonly UnasApiCustomer[],
    now: Date = new Date(),
  ): Promise<UnasTaxBackfillCounts | null> {
    return prisma.$transaction(
      async (tx) => {
        const ran = await tx.domainEvent.findUnique({
          where: { id: UNAS_TAX_BACKFILL_EVENT_ID },
          select: { id: true },
        });
        if (ran) return null;
        const counts = emptyBackfillCounts();
        const filled: { customerId: string; fields: string[] }[] = [];
        for (const customer of customers) {
          counts.customers += 1;
          const reference = await tx.externalReference.findUnique({
            where: {
              system_entityType_externalId: {
                system: "UNAS",
                entityType: EXTERNAL_ENTITY_TYPE,
                externalId: customer.externalId,
              },
            },
            select: { entityId: true, metadata: true },
          });
          if (!reference) {
            counts.noOsRow += 1;
            continue;
          }
          if (mergedFrom(reference.metadata)) {
            counts.merged += 1;
            continue;
          }
          const fill = unasCustomerFill(customer);
          const exists = await tx.customer.count({
            where: { id: reference.entityId },
          });
          if (exists === 0) {
            counts.noOsRow += 1;
            continue;
          }
          const written =
            (await fillEmptyFields(tx, reference.entityId, fill)) ?? {};
          counts[unasTaxBackfillBucket(customer, fill, written)] += 1;
          if (written.companyName) counts.companyNameFilled += 1;
          if (Object.keys(written).length > 0)
            filled.push({
              customerId: reference.entityId,
              fields: Object.keys(written).sort(),
            });
        }
        await tx.domainEvent.create({
          data: {
            id: UNAS_TAX_BACKFILL_EVENT_ID,
            eventType: "customer.unas-tax-fields-backfilled",
            aggregateType: "Customer",
            aggregateId: "UNAS",
            payload: json({ ...counts, filled }),
            occurredAt: now,
          },
        });
        return counts;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
      },
    );
  }
}
