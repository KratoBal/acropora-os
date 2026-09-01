import type { Prisma } from "@acropora/database";

import { OUTBOX_BASELINE_UNKNOWN_NOTE } from "../common/inventory-movement-writer.js";

/// ONE outbox double for the four repository specs that need one.
///
/// WHY IT EXISTS: on 2026-09-01 the same field was wrong in three of the four
/// hand-written doubles - `create` returned `{}` where the contract promises
/// `{id}`, and the movement writer uses that id. Four people wrote the same
/// object four times and each left out the same thing, because nothing asked
/// them for it. Measured before writing this: `findFirst` and `update` were
/// byte-identical in all four, `create` differed only in which fields the row
/// carried, and `updateMany` in one extra where-shape. No test depended on a
/// double doing something the others did not, and none depended on a double
/// LACKING something - so a union serves all four.
///
/// AND ONE THING NO DOUBLE HAD: `resolutionNote`. The movement writer both
/// filters on it (it must not supersede a baseline-unknown row) and writes it
/// (`superseded_by:`). All four doubles ignored it, so the exclusion existed
/// in production and in none of these tests.
export interface OutboxDoubleRow {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string | null;
  status: string;
  idempotencyKey: string;
  sourceProcess: string | null;
  sourceRecordId: string | null;
  targetOnHand: Prisma.Decimal;
  resolutionNote: string | null;
}

/// Builds the double over a caller-owned array, so a spec keeps asserting on
/// its own `db.outbox` exactly as before.
export function createOutboxDouble(
  rows: OutboxDoubleRow[],
  nextId: (prefix: string) => string,
) {
  return {
    findFirst: async (args: unknown) => {
      const { where } = args as {
        where: {
          variantId?: string;
          warehouseId?: string;
          resolutionNote?: string;
          status?: string;
        };
      };
      return (
        rows.find(
          (row) =>
            (where.variantId === undefined ||
              row.variantId === where.variantId) &&
            (where.warehouseId === undefined ||
              row.warehouseId === where.warehouseId) &&
            (where.resolutionNote === undefined ||
              row.resolutionNote === where.resolutionNote) &&
            (where.status === undefined || row.status === where.status),
        ) ?? null
      );
    },

    update: async (args: unknown) => {
      const { where, data } = args as {
        where: { id: string };
        data: { status?: string; resolutionNote?: string };
      };
      const row = rows.find((candidate) => candidate.id === where.id);
      if (row) {
        if (data.status !== undefined) row.status = data.status;
        if (data.resolutionNote !== undefined)
          row.resolutionNote = data.resolutionNote;
      }
      return {};
    },

    updateMany: async (args: unknown) => {
      const { where, data } = args as {
        where: {
          variantId?: string;
          warehouseId?: string;
          idempotencyKey?: string;
          status?: { in: string[] };
          resolutionNote?: { not: string };
        };
        data: {
          status?: string;
          resolutionNote?: string;
          targetOnHand?: unknown;
        };
      };

      /// The purchase-invoice repository looks rows up by idempotency key, the
      /// others by (variant, warehouse, status). Both are real production
      /// shapes - measured at five call sites - so the double answers both
      /// rather than pretending only one exists.
      let count = 0;
      for (const row of rows) {
        const matchesKey =
          where.idempotencyKey !== undefined &&
          row.idempotencyKey === where.idempotencyKey;
        const matchesPair =
          where.idempotencyKey === undefined &&
          (where.variantId === undefined ||
            row.variantId === where.variantId) &&
          (where.warehouseId === undefined ||
            row.warehouseId === where.warehouseId) &&
          (where.status === undefined || where.status.in.includes(row.status));

        /// A baseline-unknown row is deliberately NOT superseded - see the
        /// movement writer. No hand-written double modelled this, so the
        /// exclusion was never exercised by these specs.
        const noteExcluded =
          where.resolutionNote !== undefined &&
          row.resolutionNote === where.resolutionNote.not;

        if ((matchesKey || matchesPair) && !noteExcluded) {
          if (data.status !== undefined) row.status = data.status;
          if (data.resolutionNote !== undefined)
            row.resolutionNote = data.resolutionNote;
          if (data.targetOnHand !== undefined)
            row.targetOnHand = data.targetOnHand as Prisma.Decimal;
          count += 1;
        }
      }
      return { count };
    },

    create: async (args: unknown) => {
      const { data } = args as {
        data: {
          variantId: string;
          warehouseId: string;
          sku?: string;
          idempotencyKey: string;
          sourceProcess?: string;
          sourceRecordId?: string;
          targetOnHand: Prisma.Decimal;
        };
      };
      /// Returns the id, as the contract promises. Three of the four doubles
      /// returned `{}` here, and the movement writer needs the id to
      /// dead-letter a publish whose baseline was never known.
      const row: OutboxDoubleRow = {
        id: nextId("outbox"),
        variantId: data.variantId,
        warehouseId: data.warehouseId,
        sku: data.sku ?? null,
        status: "PENDING",
        idempotencyKey: data.idempotencyKey,
        sourceProcess: data.sourceProcess ?? null,
        sourceRecordId: data.sourceRecordId ?? null,
        targetOnHand: data.targetOnHand,
        resolutionNote: null,
      };
      rows.push(row);
      return { id: row.id };
    },
  };
}

/// Referenced so the note constant and the double cannot drift apart: if the
/// writer renames it, this file stops compiling.
export const OUTBOX_DOUBLE_BASELINE_NOTE = OUTBOX_BASELINE_UNKNOWN_NOTE;
