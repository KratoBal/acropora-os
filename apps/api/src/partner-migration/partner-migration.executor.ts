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

/**
 * A TERV ELAVULT: az írás közben kiderül, hogy a próba óta változott valami (a partner már kötött, a vevő-sor eltűnt vagy másé lett).
 * Csak ez a hiba megy ki a kliensnek érthető üzenettel (409); minden más hiba (adatbázis, kényszer) nem.
 */
export class StalePlanError extends Error {}

export interface RegisterOutcome {
  code: string;
  mode: "CREATED" | "BOUND" | "FILLED" | "SKIPPED";
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
    if (!supplier)
      throw new StalePlanError(`A partner nem található: ${op.code}.`);

    if (op.kind === "FILL") {
      // a már kötött vevő-sor üres mezőinek kitöltése: a kötés a próba óta nem változhatott
      if (supplier.customerId !== op.customerId)
        throw new StalePlanError(
          `A(z) ${op.code} partner kötése megváltozott a próba óta: a terv elavult, nézd meg újra a próbafuttatást.`,
        );
      const linked = await tx.customer.findUnique({
        where: { id: op.customerId },
        select: { id: true, archivedAt: true },
      });
      if (!linked || linked.archivedAt)
        throw new StalePlanError(
          `A(z) ${op.code} kötött vevő-sora nem található vagy archivált.`,
        );
      const written = await applyFills(tx, op.customerId, op.fills);
      await recordFilled(tx, op, op.customerId, written, actorUserId);
      outcomes.push({
        code: op.code,
        mode: "FILLED",
        customerId: op.customerId,
        detail: written.length
          ? written.join(", ")
          : "nem íródott semmi (a mezők közben kitöltődtek)",
      });
      continue;
    }

    if (supplier.customerId)
      throw new StalePlanError(
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
      throw new StalePlanError(
        `A(z) ${op.code} jelölt vevő-sora nem található vagy archivált.`,
      );
    if (customer.partner)
      throw new StalePlanError(
        `A(z) ${op.code} jelölt vevő-sora már egy másik partnerhez kötött.`,
      );
    await tx.supplier.update({
      where: { id: supplier.id },
      data: { customerId: customer.id },
    });
    await markUnasReferences(tx, customer.id, supplier.id);
    await record(tx, op, customer.id, "BOUND", actorUserId);
    // a kötődő vevő-sor üres mezői a partner értékeivel (ahol a próba kitöltést mutatott)
    const written = await applyFills(tx, customer.id, op.fills);
    if (written.length)
      await recordFilled(tx, op, customer.id, written, actorUserId);
    outcomes.push({
      code: op.code,
      mode: "BOUND",
      customerId: customer.id,
      ...(written.length ? { detail: `kitöltve: ${written.join(", ")}` } : {}),
    });
  }
  return outcomes;
}

/**
 * A KITÖLTÉS: a vevő-sor ÜRES mezői a partner értékeivel. Minden mező FELTÉTELES írás (`updateMany` az "üres" feltétellel), tehát egy
 * közben kitöltött mezőt nem ír felül, akkor sem, ha a lenyomat egyezik. A szerviz-partnerkód egyedi: ha egy MÁSIK vevő-soron már áll,
 * nem íródik. Visszaadja, mely mezők íródtak tényleg (csak a mezőnevek: az érték személyes adat lehet, az eseménybe nem kerül).
 */
async function applyFills(
  tx: Tx,
  customerId: string,
  fills: readonly { field: string; value: string | number }[],
): Promise<string[]> {
  const written: string[] = [];
  for (const fill of fills) {
    if (fill.field === "paymentDueDays" && typeof fill.value === "number") {
      const result = await tx.customer.updateMany({
        where: { id: customerId, paymentDueDays: null },
        data: { paymentDueDays: fill.value },
      });
      if (result.count === 1) written.push(fill.field);
    } else if (
      fill.field === "billingEmail" &&
      typeof fill.value === "string"
    ) {
      const result = await tx.customer.updateMany({
        where: {
          id: customerId,
          OR: [{ billingEmail: null }, { billingEmail: "" }],
        },
        data: { billingEmail: fill.value },
      });
      if (result.count === 1) written.push(fill.field);
    } else if (
      fill.field === "worksheetPartnerCode" &&
      typeof fill.value === "string"
    ) {
      const taken = await tx.customer.findFirst({
        where: { worksheetPartnerCode: fill.value, id: { not: customerId } },
        select: { id: true },
      });
      if (taken) continue;
      const result = await tx.customer.updateMany({
        where: {
          id: customerId,
          OR: [{ worksheetPartnerCode: null }, { worksheetPartnerCode: "" }],
        },
        data: { worksheetPartnerCode: fill.value },
      });
      if (result.count === 1) written.push(fill.field);
    }
  }
  return written;
}

async function recordFilled(
  tx: Tx,
  op: MigrationOperation,
  customerId: string,
  fields: readonly string[],
  actorUserId: string | null,
) {
  await tx.domainEvent.create({
    data: {
      id: randomUUID(),
      eventType: "partner.filled",
      aggregateType: "Supplier",
      aggregateId: op.supplierId,
      actorUserId,
      // csak azonosító és mezőnevek: se e-mail cím, se érték
      payload: { customerId, fields: [...fields] },
      occurredAt: new Date(),
      schemaVersion: 1,
    },
  });
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
 * A VISSZAÁLLÍTÁS: minden partnerre, amelynek LEGUTOLSÓ eseménye a `partner.registered` (egy partner többször is átvezethető és
 * visszaállítható). A LÉTREHOZOTT sor csak akkor törlődik, ha azóta semmi nem hivatkozik rá (se számla, se rendelés, se szerződés,
 * se munkalap, se árajánlat, se szerviz-munka, se Reef Club kötés vagy kód, se összevonás-napló, se alias, se UNAS-hivatkozás);
 * különben marad, és a partner kötése sem oldódik (kimondva az eredményben). A KÖTÖTT sornál a kötés oldódik és a jelölés
 * (`mergedFrom`) törlődik; a vevő-sor megmarad, de a partner közbeni mentései már a partner adatait másolták rá (név, adószám,
 * e-mail, cím, fizetési nap): a kötés előtti mezőket a visszaállítás nem állítja vissza.
 */
export async function restoreRegistered(
  tx: Tx,
  actorUserId: string | null,
  /** igaz: csak azt számolja ki, mit állítana vissza, semmit nem ír */
  dryRun = false,
): Promise<RestoreOutcome[]> {
  // PARTNERENKÉNT A LEGUTOLSÓ ESEMÉNY DÖNT (barracuda, #2185 review): egy partner többször is átvezethető és visszaállítható
  // (stage-próba: apply, restore, apply, restore), és a visszaállítandó az, amelyiknél a legutolsó esemény a `registered`.
  const events = await tx.domainEvent.findMany({
    where: {
      eventType: { in: ["partner.registered", "partner.unregistered"] },
      aggregateType: "Supplier",
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { aggregateId: true, eventType: true, payload: true },
  });
  const lastBySupplier = new Map<string, (typeof events)[number]>();
  for (const event of events) lastBySupplier.set(event.aggregateId, event);
  const registered = [...lastBySupplier.values()].filter(
    (event) => event.eventType === "partner.registered",
  );
  const outcomes: RestoreOutcome[] = [];
  for (const event of registered) {
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
        // a VISSZAVONT összevonások naplója nem tartja vissza a sort (a `Restrict` kulcs viszont a törlést tartaná): a napló sorai
        // törlődnek, a történet a `customer.merged` és `customer.unmerged` eseményekben marad. Az ÉLŐ összevonás naplóját a számlálás
        // már megfogta, ide csak visszavont napló jut; a szűrő ezt itt is kimondja, hogy egy élő napló sosem törlődhet.
        const removable = {
          OR: [
            { keptId: payload.customerId },
            { mergedId: payload.customerId },
          ],
          undoneAt: { not: null },
        };
        // az összevonás naplózása ígéret: a napló törlése előtt a TARTALMA egy eseménybe kerül (csak azonosítók és mezőnevek, ahogy a
        // napló maga is), így a részlet a sor törlése után is visszakereshető (barracuda, #2196 review)
        const logs = await tx.customerMergeLog.findMany({
          where: removable,
          select: {
            id: true,
            keptId: true,
            mergedId: true,
            actorUserId: true,
            reason: true,
            movedRefs: true,
            fieldChanges: true,
            createdAt: true,
            undoneAt: true,
          },
        });
        for (const log of logs)
          await tx.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "customer.merge-log-removed",
              aggregateType: "Customer",
              aggregateId: payload.customerId,
              actorUserId,
              payload: {
                logId: log.id,
                keptId: log.keptId,
                mergedId: log.mergedId,
                mergeActorUserId: log.actorUserId,
                reason: log.reason,
                movedRefs: log.movedRefs,
                fieldChanges: log.fieldChanges,
                createdAt: log.createdAt.toISOString(),
                undoneAt: log.undoneAt?.toISOString() ?? null,
                removedBy: "partner.restore",
              } as Prisma.InputJsonValue,
              occurredAt: new Date(),
              schemaVersion: 1,
            },
          });
        await tx.customerMergeLog.deleteMany({ where: removable });
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
    tx.rental.count({ where }),
    tx.user.count({ where }),
    // a Cascade-os hivatkozók (a törlés CSENDBEN törölné őket) és a Restrict-esek (a törlés hibát dobna, és az egész visszaállítás
    // visszagördülne egyetlen sor miatt): barracuda, #2185 review
    tx.reefClubLinkCode.count({ where }),
    tx.reefClubCustomerLink.count({ where }),
    // csak az ÉLŐ (nem visszavont) összevonás naplója: egy visszavont összevonás a sort már nem köti (stage-próba, 2026-11-04:
    // átvezetés, összevonás, visszavonás után a visszaállítás a visszavont napló miatt örökre KEPT maradt)
    tx.customerMergeLog.count({
      where: {
        OR: [{ keptId: customerId }, { mergedId: customerId }],
        undoneAt: null,
      },
    }),
    tx.customer.count({ where: { mergedIntoId: customerId } }),
    // nem FK, törlés után árván maradna
    tx.externalReference.count({
      where: { entityType: "Customer", entityId: customerId },
    }),
    tx.customerAlias.count({ where }),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}
