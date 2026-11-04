import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Repository, prisma, Prisma } from "@acropora/database";
import {
  type PartnerMergeExecuteInput,
  type PartnerMergeLogEntry,
  type PartnerMergePreview,
  type PartnerMergeReferenceTable,
  type PartnerMergeSide,
  type PartnerMergeUndoResult,
} from "@acropora/types";

import {
  planFieldMerge,
  planRowBlockers,
  previewFingerprint,
  type MergeFacts,
} from "./partner-merge-plan.js";

/**
 * EGY PARTNERTÖRZS, 4. LÉPÉS: AZ ÖSSZEVONÁS-SZOLGÁLTATÁS (terv 3.3, 4.4). Két vevő-sor egybe: a megmaradó (`kept`) kapja a
 * megszűnő (`merged`) minden hivatkozását, a megszűnő sor ARCHIVÁLÓDIK (nem törlődik), és minden áthelyezett sor azonosítóval a
 * `CustomerMergeLog`-ba kerül, ebből a visszavonás kiolvasható. A kiállított számlák TARTALMA nem változik (vevő-pillanatkép,
 * Számlázz.hu-ban tárolt bizonylat): csak az `Invoice.customerId` mutat a megmaradóra.
 *
 * AMI NEM TÖRTÉNIK: a címeket nem vonja össze (mind átkerül, az azonos is; a megmaradó sor alapértelmezett címe marad az
 * alapértelmezett, az átkerültek nem alapértelmezettek), a megszűnő sor adata nem íródik át, és a `Supplier` kötést nem helyezi át
 * (két partner-profil összevonása külön lépés).
 */

/** Egy hivatkozó tábla: a Prisma-delegate neve és a vevőre mutató mező. */
interface ReferenceSpec {
  table: PartnerMergeReferenceTable;
  delegate: string;
  field: string;
  /** a szűrés kiegészítése (az `ExternalReference` csak a Customer típusnál) */
  where?: Record<string, unknown>;
}

export const REFERENCE_SPECS: readonly ReferenceSpec[] = [
  { table: "SalesOrder", delegate: "salesOrder", field: "customerId" },
  { table: "Aquarium", delegate: "aquarium", field: "customerId" },
  { table: "ServiceJob", delegate: "serviceJob", field: "customerId" },
  { table: "Invoice", delegate: "invoice", field: "customerId" },
  { table: "Project", delegate: "project", field: "customerId" },
  { table: "Asset", delegate: "asset", field: "customerId" },
  {
    table: "WorksheetDepartment",
    delegate: "worksheetDepartment",
    field: "customerId",
  },
  { table: "Worksheet", delegate: "worksheet", field: "customerId" },
  { table: "Contract", delegate: "contract", field: "customerId" },
  { table: "Quote", delegate: "quote", field: "customerId" },
  { table: "PartnerOrder", delegate: "partnerOrder", field: "customerId" },
  {
    table: "ReefClubCustomerLink",
    delegate: "reefClubCustomerLink",
    field: "customerId",
  },
  {
    table: "ReefClubLinkCode",
    delegate: "reefClubLinkCode",
    field: "customerId",
  },
  { table: "User", delegate: "user", field: "customerId" },
  {
    table: "CustomerAddress",
    delegate: "customerAddress",
    field: "customerId",
  },
  { table: "CustomerAlias", delegate: "customerAlias", field: "customerId" },
  {
    table: "ExternalReference",
    delegate: "externalReference",
    field: "entityId",
    where: { entityType: "Customer" },
  },
];

/** A delegate-ek közös, szűk alakja (a Prisma generált típusai táblánként mások). */
interface RefDelegate {
  count(args: { where: object }): Promise<number>;
  findMany(args: {
    where: object;
    select: Record<string, boolean>;
  }): Promise<Array<{ id: string; isDefault?: boolean; type?: string }>>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
}
const delegateOf = (client: unknown, spec: ReferenceSpec): RefDelegate =>
  (client as Record<string, RefDelegate>)[spec.delegate]!;

/** A napló egy áthelyezett sora. */
interface MovedRef {
  table: PartnerMergeReferenceTable;
  id: string;
  field: string;
  /** csak a címnél: az eredeti alapértelmezett jelző (a visszavonás visszaállítja) */
  wasDefault?: boolean;
  /** csak a címnél: a cím típusa (az alapértelmezett jelző típusonként számít) */
  addressType?: string;
}

/** A napló mező-változásai: a megmaradó soron mi töltődött ki honnan, hogy a visszavonás ugyanazt vegye vissza. */
interface FieldChangeLog {
  fills: Array<{
    field: string;
    kind: string;
    into: string;
    before?: string | null;
  }>;
  mergedWasActive: boolean;
}

type Tx = Prisma.TransactionClient;

const CUSTOMER_SELECT = {
  id: true,
  customerNumber: true,
  displayName: true,
  type: true,
  companyName: true,
  worksheetPartnerCode: true,
  taxNumber: true,
  euTaxNumber: true,
  email: true,
  billingEmail: true,
  phone: true,
  paymentDueDays: true,
  isActive: true,
  archivedAt: true,
  mergedIntoId: true,
  partner: { select: { id: true } },
} as const;

type CustomerRow = Prisma.CustomerGetPayload<{
  select: typeof CUSTOMER_SELECT;
}>;

const factsOf = (row: CustomerRow): MergeFacts => ({
  id: row.id,
  customerNumber: row.customerNumber,
  displayName: row.displayName,
  type: row.type,
  companyName: row.companyName,
  worksheetPartnerCode: row.worksheetPartnerCode,
  taxNumber: row.taxNumber,
  euTaxNumber: row.euTaxNumber,
  email: row.email,
  billingEmail: row.billingEmail,
  phone: row.phone,
  paymentDueDays: row.paymentDueDays,
  archivedAt: row.archivedAt,
  mergedIntoId: row.mergedIntoId,
  hasSupplier: row.partner !== null,
});

async function countReferences(
  tx: Tx,
  customerId: string,
): Promise<Partial<Record<PartnerMergeReferenceTable, number>>> {
  const counts: Partial<Record<PartnerMergeReferenceTable, number>> = {};
  for (const spec of REFERENCE_SPECS) {
    const count = await delegateOf(tx, spec).count({
      where: { [spec.field]: customerId, ...spec.where },
    });
    if (count > 0) counts[spec.table] = count;
  }
  return counts;
}

const sideOf = (
  row: CustomerRow | null,
  references: Partial<Record<PartnerMergeReferenceTable, number>>,
): PartnerMergeSide | null =>
  row
    ? {
        id: row.id,
        customerNumber: row.customerNumber,
        displayName: row.displayName,
        companyName: row.companyName,
        type: row.type,
        taxNumber: row.taxNumber,
        euTaxNumber: row.euTaxNumber,
        email: row.email,
        partnerMirror: row.partner !== null,
        archived: row.archivedAt !== null,
        references,
      }
    : null;

/** Az előnézet, egy tranzakciós klienssel: az előnézet és a végrehajtás UGYANEZT a számítást futtatja. */
export async function buildPreview(
  tx: Tx,
  keptId: string,
  mergedId: string,
): Promise<{
  preview: PartnerMergePreview;
  keptRow: CustomerRow | null;
  mergedRow: CustomerRow | null;
  keptData: Record<string, string | number | null>;
  clearOnMerged: string[];
}> {
  const [keptRow, mergedRow] = await Promise.all([
    tx.customer.findUnique({ where: { id: keptId }, select: CUSTOMER_SELECT }),
    tx.customer.findUnique({
      where: { id: mergedId },
      select: CUSTOMER_SELECT,
    }),
  ]);
  const kept = keptRow ? factsOf(keptRow) : null;
  const merged = mergedRow ? factsOf(mergedRow) : null;
  const rows = planRowBlockers(kept, merged, { keptId, mergedId });
  const fields =
    kept && merged
      ? planFieldMerge(kept, merged)
      : { keptData: {}, clearOnMerged: [], fills: [], notes: [], blockers: [] };
  const [keptRefs, mergedRefs] = await Promise.all([
    keptRow ? countReferences(tx, keptId) : Promise.resolve({}),
    mergedRow ? countReferences(tx, mergedId) : Promise.resolve({}),
  ]);
  // EGY VEVŐ-SORON MA EGY UNAS-FIÓK ÁLLHAT (az ExternalReference entitás-kulcsa egyedi): ha mindkét sornak van, az áthelyezés az
  // adatbázis egyediségén bukna, ezért előre megáll, és megnevezi az okot. A több fiókot engedő sémaváltozás külön lépés.
  if (
    (keptRefs as Record<string, number>).ExternalReference &&
    (mergedRefs as Record<string, number>).ExternalReference
  )
    fields.blockers.push(
      "Mindkét sornak van UNAS-hivatkozása: egy vevő-soron ma egy UNAS-fiók állhat (a több fiókot engedő sémaváltozás külön lépés).",
    );
  const blockers = [...rows.blockers, ...fields.blockers];
  const preview: PartnerMergePreview = {
    keptId,
    mergedId,
    kept: sideOf(keptRow, keptRefs),
    merged: sideOf(mergedRow, mergedRefs),
    willMove: mergedRefs,
    fieldFills: fields.fills,
    notes: fields.notes,
    blockers,
    suggestSwap: rows.suggestSwap,
    canExecute: blockers.length === 0,
    fingerprint: previewFingerprint({
      keptId,
      mergedId,
      willMove: mergedRefs,
      fieldFills: fields.fills,
    }),
  };
  return {
    preview,
    keptRow,
    mergedRow,
    keptData: fields.keptData,
    clearOnMerged: fields.clearOnMerged,
  };
}

@Injectable()
export class PartnerMergeRepository extends Repository {
  constructor() {
    super(prisma);
  }

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.database.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      // egy sok hivatkozású vevő áthelyezése hosszabb a megszokottnál
      timeout: 120_000,
      maxWait: 30_000,
    });
  }
}

@Injectable()
export class PartnerMergeService {
  constructor(private readonly repository: PartnerMergeRepository) {}

  preview(keptId: string, mergedId: string): Promise<PartnerMergePreview> {
    return this.repository
      .transaction((tx) => buildPreview(tx, keptId, mergedId))
      .then((result) => result.preview);
  }

  async execute(
    input: PartnerMergeExecuteInput,
    actorUserId: string,
  ): Promise<PartnerMergeLogEntry> {
    return this.repository.transaction(async (tx) => {
      const built = await buildPreview(tx, input.keptId, input.mergedId);
      const { preview, keptRow, mergedRow } = built;
      if (!keptRow || !mergedRow || !preview.canExecute)
        throw new BadRequestException(
          preview.blockers.length
            ? preview.blockers.join(" ")
            : "Az összevonás nem hajtható végre.",
        );
      if (preview.fingerprint !== input.fingerprint)
        throw new ConflictException(
          "Az előnézet óta változott a két sor vagy a hivatkozásaik: nézd meg újra az előnézetet.",
        );

      const log = await tx.customerMergeLog.create({
        data: {
          keptId: keptRow.id,
          mergedId: mergedRow.id,
          actorUserId,
          reason: input.reason?.trim() || null,
          movedRefs: [],
        },
      });

      // 1. a hivatkozások: pontosan azok a sorok, amiket megszámoltunk, azonosítóval a naplóba
      const moved: MovedRef[] = [];
      const keptDefaultTypes = new Set<string>(
        (
          await tx.customerAddress.findMany({
            where: { customerId: keptRow.id, isDefault: true },
            select: { type: true },
          })
        ).map((address) => address.type),
      );
      for (const spec of REFERENCE_SPECS) {
        const delegate = delegateOf(tx, spec);
        const select: Record<string, boolean> = { id: true };
        if (spec.table === "CustomerAddress") {
          select.isDefault = true;
          select.type = true;
        }
        const rows = await delegate.findMany({
          where: { [spec.field]: mergedRow.id, ...spec.where },
          select,
        });
        if (rows.length === 0) continue;
        const ids = rows.map((row) => row.id);
        const result = await delegate.updateMany({
          where: { id: { in: ids }, [spec.field]: mergedRow.id },
          data: { [spec.field]: keptRow.id },
        });
        if (result.count !== ids.length)
          throw new ConflictException(
            `A(z) ${spec.table} sorai közben változtak: nézd meg újra az előnézetet.`,
          );
        for (const row of rows)
          moved.push({
            table: spec.table,
            id: row.id,
            field: spec.field,
            ...(spec.table === "CustomerAddress" && row.isDefault !== undefined
              ? { wasDefault: row.isDefault, addressType: row.type }
              : {}),
          });
      }
      // az átkerült cím nem lesz alapértelmezett, ha a megmaradó sornak már van alapértelmezett ILYEN TÍPUSÚ címe (a számlázás
      // ne válasszon találomra két alapértelmezett közül); a jelző a naplóban van, a visszavonás visszaállítja
      const defaultsToClear = moved
        .filter(
          (ref) =>
            ref.table === "CustomerAddress" &&
            ref.wasDefault === true &&
            ref.addressType !== undefined &&
            keptDefaultTypes.has(ref.addressType),
        )
        .map((ref) => ref.id);
      if (defaultsToClear.length)
        await tx.customerAddress.updateMany({
          where: { id: { in: defaultsToClear } },
          data: { isDefault: false },
        });

      // 2. a UNAS-hivatkozások jelölése: a vevő-szinkron a jelölt hivatkozásnál nem ír a vevő-sorra (szerződés nautilusszal)
      const references = moved.filter(
        (ref) => ref.table === "ExternalReference",
      );
      for (const ref of references) {
        const row = await tx.externalReference.findUnique({
          where: { id: ref.id },
          select: { metadata: true },
        });
        const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
        await tx.externalReference.update({
          where: { id: ref.id },
          data: {
            metadata: {
              ...metadata,
              mergedFrom: mergedRow.id,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // 3. a mezők: előbb a megszűnőről a szerviz-kód (egyedi), aztán a megmaradóra az üres mezők
      const fieldLog: FieldChangeLog = {
        fills: built.preview.fieldFills.map((fill) => ({
          ...fill,
          ...(fill.kind === "type" ? { before: keptRow.type } : {}),
        })),
        mergedWasActive: mergedRow.isActive,
      };
      if (built.clearOnMerged.length)
        await tx.customer.update({
          where: { id: mergedRow.id },
          data: Object.fromEntries(
            built.clearOnMerged.map((field) => [field, null]),
          ),
        });
      if (Object.keys(built.keptData).length)
        await tx.customer.update({
          where: { id: keptRow.id },
          data: built.keptData,
        });

      // 4. a régi azonosítók (a keresés és a levelek a régi számmal is megtalálják a céget)
      await tx.customerAlias.createMany({
        data: [
          {
            customerId: keptRow.id,
            value: mergedRow.customerNumber,
            kind: "CUSTOMER_NUMBER",
            mergeLogId: log.id,
          },
          {
            customerId: keptRow.id,
            value: mergedRow.id,
            kind: "ROW_ID",
            mergeLogId: log.id,
          },
        ],
        skipDuplicates: true,
      });

      // 5. a megszűnő sor archiválva, nem törölve
      await tx.customer.update({
        where: { id: mergedRow.id },
        data: {
          archivedAt: new Date(),
          isActive: false,
          mergedIntoId: keptRow.id,
        },
      });

      const updatedLog = await tx.customerMergeLog.update({
        where: { id: log.id },
        data: {
          movedRefs: moved as unknown as Prisma.InputJsonValue,
          fieldChanges: fieldLog as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "customer.merged",
          aggregateType: "Customer",
          aggregateId: keptRow.id,
          actorUserId,
          // csak azonosítók és számok: se név, se adószám, se e-mail
          payload: {
            mergedId: mergedRow.id,
            logId: log.id,
            moved: countByTable(moved),
          },
          occurredAt: new Date(),
          schemaVersion: 1,
        },
      });
      return toLogEntry(updatedLog, moved);
    });
  }

  async undo(
    logId: string,
    actorUserId: string,
  ): Promise<PartnerMergeUndoResult> {
    return this.repository.transaction(async (tx) => {
      const log = await tx.customerMergeLog.findUnique({
        where: { id: logId },
      });
      if (!log)
        throw new NotFoundException("Az összevonás naplója nem található.");
      if (log.undoneAt)
        throw new ConflictException("Ezt az összevonást már visszavonták.");
      const [kept, merged] = await Promise.all([
        tx.customer.findUnique({
          where: { id: log.keptId },
          select: CUSTOMER_SELECT,
        }),
        tx.customer.findUnique({
          where: { id: log.mergedId },
          select: CUSTOMER_SELECT,
        }),
      ]);
      if (!kept || !merged)
        throw new ConflictException(
          "Az összevont sorok egyike már nem létezik.",
        );
      if (merged.mergedIntoId !== kept.id)
        throw new ConflictException(
          "A megszűnő sor már nincs ebbe a sorba vonva: nincs mit visszavonni.",
        );
      if (kept.archivedAt || kept.mergedIntoId)
        throw new ConflictException(
          "A megmaradó sort azóta egy másikba vonták: előbb azt az összevonást kell visszavonni.",
        );

      const moved = (log.movedRefs ?? []) as unknown as MovedRef[];
      const fieldLog = (log.fieldChanges ?? {
        fills: [],
        mergedWasActive: true,
      }) as unknown as FieldChangeLog;
      const restored: Partial<Record<PartnerMergeReferenceTable, number>> = {};
      const skipped: Partial<Record<PartnerMergeReferenceTable, number>> = {};

      // a hivatkozások: csak az megy vissza, ami még a megmaradóra mutat (ami közben máshová került, marad)
      for (const spec of REFERENCE_SPECS) {
        const refs = moved.filter((ref) => ref.table === spec.table);
        if (refs.length === 0) continue;
        const ids = refs.map((ref) => ref.id);
        const result = await delegateOf(tx, spec).updateMany({
          where: { id: { in: ids }, [spec.field]: kept.id, ...spec.where },
          data: { [spec.field]: merged.id },
        });
        if (result.count > 0) restored[spec.table] = result.count;
        if (ids.length - result.count > 0)
          skipped[spec.table] = ids.length - result.count;
        if (spec.table === "CustomerAddress") {
          const wasDefault = refs
            .filter((ref) => ref.wasDefault)
            .map((ref) => ref.id);
          if (wasDefault.length)
            await tx.customerAddress.updateMany({
              where: { id: { in: wasDefault }, customerId: merged.id },
              data: { isDefault: true },
            });
        }
        if (spec.table === "ExternalReference") {
          for (const ref of refs) {
            const row = await tx.externalReference.findUnique({
              where: { id: ref.id },
              select: { entityId: true, metadata: true },
            });
            if (row?.entityId !== merged.id) continue;
            const { mergedFrom: _drop, ...rest } = (row.metadata ??
              {}) as Record<string, unknown>;
            void _drop;
            await tx.externalReference.update({
              where: { id: ref.id },
              data: { metadata: rest as Prisma.InputJsonValue },
            });
          }
        }
      }
      // a régi azonosítók, amiket az összevonás vett fel
      await tx.customerAlias.deleteMany({ where: { mergeLogId: log.id } });

      // a mezők: csak az megy vissza, ami még azt az értéket hordozza, amit az összevonás másolt (egy közbeni kézi szerkesztés marad)
      const keptUpdate: Record<string, string | null> = {};
      const mergedUpdate: Record<string, string | null> = {};
      for (const fill of fieldLog.fills) {
        const mergedValue = (merged as unknown as Record<string, unknown>)[
          fill.field
        ];
        const keptValue = (kept as unknown as Record<string, unknown>)[
          fill.into
        ];
        if (fill.kind === "type") {
          if (kept.type === "COMPANY") keptUpdate.type = fill.before ?? null;
        } else if (fill.kind === "move") {
          if (keptValue !== null && keptValue !== undefined) {
            mergedUpdate[fill.field] = keptValue as string;
            keptUpdate[fill.into] = null;
          }
        } else if (
          typeof keptValue === "string" &&
          typeof mergedValue === "string" &&
          keptValue.trim() === mergedValue.trim()
        )
          keptUpdate[fill.into] = null;
      }
      if (Object.keys(keptUpdate).length)
        await tx.customer.update({ where: { id: kept.id }, data: keptUpdate });
      await tx.customer.update({
        where: { id: merged.id },
        data: {
          ...mergedUpdate,
          archivedAt: null,
          isActive: fieldLog.mergedWasActive,
          mergedIntoId: null,
        },
      });
      await tx.customerMergeLog.update({
        where: { id: log.id },
        data: { undoneAt: new Date() },
      });
      await tx.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "customer.unmerged",
          aggregateType: "Customer",
          aggregateId: kept.id,
          actorUserId,
          payload: { mergedId: merged.id, logId: log.id, restored, skipped },
          occurredAt: new Date(),
          schemaVersion: 1,
        },
      });
      return { logId: log.id, restored, skipped };
    });
  }

  async list(): Promise<PartnerMergeLogEntry[]> {
    return this.repository.transaction(async (tx) => {
      const logs = await tx.customerMergeLog.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      return logs.map((log) =>
        toLogEntry(log, (log.movedRefs ?? []) as unknown as MovedRef[]),
      );
    });
  }
}

function countByTable(
  moved: readonly MovedRef[],
): Partial<Record<PartnerMergeReferenceTable, number>> {
  const counts: Partial<Record<PartnerMergeReferenceTable, number>> = {};
  for (const ref of moved) counts[ref.table] = (counts[ref.table] ?? 0) + 1;
  return counts;
}

function toLogEntry(
  log: {
    id: string;
    keptId: string;
    mergedId: string;
    reason: string | null;
    createdAt: Date;
    undoneAt: Date | null;
  },
  moved: readonly MovedRef[],
): PartnerMergeLogEntry {
  return {
    id: log.id,
    keptId: log.keptId,
    mergedId: log.mergedId,
    reason: log.reason,
    createdAt: log.createdAt.toISOString(),
    undoneAt: log.undoneAt?.toISOString() ?? null,
    moved: countByTable(moved),
  };
}
