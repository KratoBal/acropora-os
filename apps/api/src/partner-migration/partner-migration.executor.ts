import { randomUUID } from "node:crypto";

import { Prisma } from "@acropora/database";

import { syncWorksheetMirror } from "../suppliers/suppliers.repository.js";
import type { MigrationOperation } from "./partner-migration-run.js";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: AZ ÍRÁS ÉS A VISSZAÁLLÍTÁS (egy Serializable tranzakcióban, a CLI hívja). Minden
 * partnerre egy `partner.registered` esemény, amiből a visszaállítás kiolvassa, mi jött létre és mi kötődött. A szerep-jelölés
 * (beszállító, szerviz-partner) NEM kap oszlopot: a `Supplier` kötésből és a jelzőiből származtatott.
 *
 * A KÖTÖTT UNAS-SOR VÉDELME: egy meglévő UNAS-vevő-sorhoz kötött partner sorát a vevő-szinkron és a partner képernyő is írhatná, két
 * író egy soron. Ezért az ilyen sor UNAS-hivatkozásaiba a `metadata.mergedFrom` jelölés kerül (a partner azonosítója): a
 * szinkron a jelölt hivatkozásnál nem ír a vevő-sorra (a szerződés a nautilus PR-jával).
 */
export type Tx = Prisma.TransactionClient;

export interface RegisterOutcome {
  code: string;
  mode: "CREATED" | "BOUND" | "SKIPPED";
  customerId?: string;
  detail?: string;
}

/** A partner mezői az új sor készítéséhez (a tükör-szinkron ugyanezeket viszi át). */
const SUPPLIER_SELECT = {
  id: true,
  code: true,
  name: true,
  taxNumber: true,
  country: true,
  email: true,
  isService: true,
  customerId: true,
  worksheetPartnerCode: true,
  paymentDueDays: true,
  postalCode: true,
  city: true,
  addressLine1: true,
  addressLine2: true,
} as const;

export async function applyOperations(
  tx: Tx,
  operations: readonly MigrationOperation[],
  actorUserId: string | null,
  /** az új sor készítése; a teszt egy dublőrt ad át */
  createRow: (
    tx: Tx,
    supplier: NonNullable<Awaited<ReturnType<typeof loadSupplier>>>,
  ) => Promise<string | null> = (transaction, supplier) =>
    syncWorksheetMirror(transaction, supplier, { register: true }),
): Promise<RegisterOutcome[]> {
  const outcomes: RegisterOutcome[] = [];
  for (const op of operations) {
    if (op.kind === "SKIP") {
      outcomes.push({ code: op.code, mode: "SKIPPED", detail: op.reason });
      continue;
    }
    const supplier = await loadSupplier(tx, op.supplierId);
    if (!supplier) throw new Error(`A partner nem található: ${op.code}.`);
    if (supplier.customerId)
      throw new Error(
        `A(z) ${op.code} partnernek már van kötött vevő-sora: a terv elavult, nézd meg újra a próbafuttatást.`,
      );

    if (op.kind === "CREATE") {
      const customerId = await createRow(tx, supplier);
      if (!customerId)
        throw new Error(`A(z) ${op.code} vevő-sora nem jött létre.`);
      await record(tx, op, customerId, "CREATED", actorUserId);
      outcomes.push({ code: op.code, mode: "CREATED", customerId });
      continue;
    }

    // BIND: a vevő-sor létezik, aktív, és még nem kötött egy partnerhez sem
    const customer = await tx.customer.findUnique({
      where: { id: op.customerId },
      select: { id: true, archivedAt: true, partner: { select: { id: true } } },
    });
    if (!customer || customer.archivedAt)
      throw new Error(
        `A(z) ${op.code} jelölt vevő-sora nem található vagy archivált.`,
      );
    if (customer.partner)
      throw new Error(
        `A(z) ${op.code} jelölt vevő-sora már egy másik partnerhez kötött.`,
      );
    await tx.supplier.update({
      where: { id: supplier.id },
      data: { customerId: customer.id },
    });
    await markUnasReferences(tx, customer.id, supplier.id);
    await record(tx, op, customer.id, "BOUND", actorUserId);
    outcomes.push({ code: op.code, mode: "BOUND", customerId: customer.id });
  }
  return outcomes;
}

function loadSupplier(tx: Tx, id: string) {
  return tx.supplier.findUnique({ where: { id }, select: SUPPLIER_SELECT });
}

async function markUnasReferences(
  tx: Tx,
  customerId: string,
  supplierId: string,
) {
  const references = await tx.externalReference.findMany({
    where: { system: "UNAS", entityType: "Customer", entityId: customerId },
    select: { id: true, metadata: true },
  });
  for (const reference of references)
    await tx.externalReference.update({
      where: { id: reference.id },
      data: {
        metadata: {
          ...((reference.metadata ?? {}) as Record<string, unknown>),
          mergedFrom: supplierId,
        } as Prisma.InputJsonValue,
      },
    });
}

async function record(
  tx: Tx,
  op: MigrationOperation,
  customerId: string,
  mode: "CREATED" | "BOUND",
  actorUserId: string | null,
) {
  await tx.domainEvent.create({
    data: {
      id: randomUUID(),
      eventType: "partner.registered",
      aggregateType: "Supplier",
      aggregateId: op.supplierId,
      actorUserId,
      // csak azonosítók és a mód: se név, se adószám
      payload: { customerId, mode },
      occurredAt: new Date(),
      schemaVersion: 1,
    },
  });
}

export interface RestoreOutcome {
  supplierId: string;
  customerId: string;
  result: "RESTORED" | "KEPT";
  detail?: string;
}

/**
 * A VISSZAÁLLÍTÁS: minden `partner.registered` eseményre, amihez még nincs `partner.unregistered`. A LÉTREHOZOTT sor csak akkor
 * törlődik, ha azóta semmi nem hivatkozik rá (se számla, se rendelés, se szerződés, se munkalap, se árajánlat, se szerviz-munka);
 * különben marad, és a partner kötése sem oldódik (kimondva az eredményben). A KÖTÖTT sornál a kötés oldódik és a jelölés
 * (`mergedFrom`) törlődik; a vevő-sor megmarad, ahogy volt.
 */
export async function restoreRegistered(
  tx: Tx,
  actorUserId: string | null,
  /** igaz: csak azt számolja ki, mit állítana vissza, semmit nem ír */
  dryRun = false,
): Promise<RestoreOutcome[]> {
  const registered = await tx.domainEvent.findMany({
    where: { eventType: "partner.registered", aggregateType: "Supplier" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { aggregateId: true, payload: true },
  });
  const undone = new Set(
    (
      await tx.domainEvent.findMany({
        where: { eventType: "partner.unregistered", aggregateType: "Supplier" },
        select: { aggregateId: true },
      })
    ).map((event) => event.aggregateId),
  );
  const outcomes: RestoreOutcome[] = [];
  for (const event of registered) {
    if (undone.has(event.aggregateId)) continue;
    const payload = event.payload as {
      customerId: string;
      mode: "CREATED" | "BOUND";
    };
    const supplier = await tx.supplier.findUnique({
      where: { id: event.aggregateId },
      select: { id: true, customerId: true },
    });
    if (!supplier || supplier.customerId !== payload.customerId) {
      outcomes.push({
        supplierId: event.aggregateId,
        customerId: payload.customerId,
        result: "KEPT",
        detail: "a partner kötése azóta más: nem nyúlunk hozzá",
      });
      continue;
    }
    if (payload.mode === "CREATED") {
      const referenced = await referencesOf(tx, payload.customerId);
      if (referenced > 0) {
        outcomes.push({
          supplierId: supplier.id,
          customerId: payload.customerId,
          result: "KEPT",
          detail: `az új vevő-sorra azóta ${referenced} hivatkozás mutat: marad, a kötés sem oldódik`,
        });
        continue;
      }
      if (!dryRun) {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { customerId: null },
        });
        await tx.customer.delete({ where: { id: payload.customerId } });
      }
    } else if (!dryRun) {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { customerId: null },
      });
      const references = await tx.externalReference.findMany({
        where: {
          system: "UNAS",
          entityType: "Customer",
          entityId: payload.customerId,
        },
        select: { id: true, metadata: true },
      });
      for (const reference of references) {
        const { mergedFrom, ...rest } = (reference.metadata ?? {}) as Record<
          string,
          unknown
        >;
        if (mergedFrom !== supplier.id) continue;
        await tx.externalReference.update({
          where: { id: reference.id },
          data: { metadata: rest as Prisma.InputJsonValue },
        });
      }
    }
    if (!dryRun)
      await tx.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "partner.unregistered",
          aggregateType: "Supplier",
          aggregateId: supplier.id,
          actorUserId,
          payload: { customerId: payload.customerId, mode: payload.mode },
          occurredAt: new Date(),
          schemaVersion: 1,
        },
      });
    outcomes.push({
      supplierId: supplier.id,
      customerId: payload.customerId,
      result: "RESTORED",
    });
  }
  return outcomes;
}

/** Az új sorra mutató hivatkozások összesen (a saját címei nem számítanak). */
async function referencesOf(tx: Tx, customerId: string): Promise<number> {
  const where = { customerId };
  const counts = await Promise.all([
    tx.invoice.count({ where }),
    tx.salesOrder.count({ where }),
    tx.contract.count({ where }),
    tx.worksheet.count({ where }),
    tx.quote.count({ where }),
    tx.serviceJob.count({ where }),
    tx.aquarium.count({ where }),
    tx.project.count({ where }),
    tx.asset.count({ where }),
    tx.worksheetDepartment.count({ where }),
    tx.partnerOrder.count({ where }),
    tx.user.count({ where }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}
