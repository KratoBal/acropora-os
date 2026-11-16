import { createHash } from "node:crypto";

import {
  MemoryRedirectStore,
  type RedirectBatchChanges,
} from "./redirect-memory-store.js";
import { redirectPathLower } from "./redirect-path.js";
import {
  redirectInvariantViolations,
  type RedirectRule,
} from "./redirect-writer.js";

/**
 * AZ ÁTIRÁNYÍTÁS-ÍRÁS VISSZAVONÁSÁNAK TERVE (card f6cb0a51, az éles lánc előtt). Tiszta függvények, adatbázis nélkül.
 *
 * A kategória- és a termék-betöltő minden írása az AuditLog sorába menti a változásait a régi állapottal együtt
 * (`metadata.changes`, lásd `MemoryRedirectStore.changes`). A visszavonás ebből dolgozik:
 *
 * - egy MÓDOSÍTOTT szabályt a régi értékeire állít vissza (`from`), de CSAK ha a szabály ma még pontosan az, amit az írás hagyott
 *   (`to`). Ha azóta valaki másik írás vagy kézi változtatás hozzányúlt, a szabályhoz nem nyúl: a későbbi változás elveszne, és a
 *   visszavonás sorrendje a kötegek fordított sorrendje. A kihagyás a jelentésben marad, nem néma;
 * - egy ÚJ szabályt kikapcsol (nem töröl: a sor és a nyoma megmarad), ugyanazzal a feltétellel: csak ha a forrás ma még ugyanarra a
 *   célra mutat és aktív.
 *
 * A TERV LENYOMATA a szárazfutás és az írás kapcsolata (mint a betöltőknél): az írás csak a szárazfutáson látott terv lenyomatával
 * megy, és ha az adatbázis közben változott, 409.
 */

/** A szabály mai állapota, amennyi az összevetéshez és a visszaíráshoz kell. */
export interface CurrentRule {
  id: string;
  sourcePath: string;
  destinationPath: string;
  isActive: boolean;
  [mezo: string]: unknown;
}

export type UndoSkipKind = "missing" | "changed-since";

export interface UndoPlan {
  batchId: string;
  /** A régi értékükre visszaállítandó szabályok (a `from` a visszaírandó mezők). */
  restores: {
    id: string;
    source: string;
    from: Record<string, unknown>;
    currentDestination: string;
  }[];
  /** A kikapcsolandó, az írás által létrehozott szabályok. */
  deactivations: { id: string; source: string; destination: string }[];
  /** A szabályok, amelyekhez a visszavonás nem nyúl, és az oka. */
  skipped: { kind: UndoSkipKind; source: string; reason: string }[];
  /** A visszavonás utáni állapotban lánc (aktív szabály célja egy másik aktív szabály forrása): nem írható. */
  invariantViolations: { source: string; destination: string }[];
}

/** Egy kötegbejegyzés `metadata.changes` mezője, ellenőrizve; `null`, ha nincs vagy nem ismert az alakja. */
export function parseBatchChanges(
  metadata: unknown,
): RedirectBatchChanges | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const changes = (metadata as { changes?: unknown }).changes;
  if (typeof changes !== "object" || changes === null) return null;
  const { created, updated } = changes as {
    created?: unknown;
    updated?: unknown;
  };
  if (!Array.isArray(created) || !Array.isArray(updated)) return null;
  const jo =
    created.every(
      (c) =>
        typeof c?.source === "string" && typeof c?.destination === "string",
    ) &&
    updated.every(
      (u) =>
        typeof u?.id === "string" &&
        typeof u?.source === "string" &&
        typeof u?.from === "object" &&
        u.from !== null &&
        typeof u?.to === "object" &&
        u.to !== null,
    );
  return jo ? (changes as RedirectBatchChanges) : null;
}

function same(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * A TERV. `byId` a módosított szabályok mai sora azonosító szerint, `bySource` az új szabályok mai sora a kisbetűs forrás szerint,
 * `allActive` az összes aktív szabály (a lánc-ellenőrzéshez).
 */
export async function planRedirectUndo(
  batchId: string,
  changes: RedirectBatchChanges,
  byId: ReadonlyMap<string, CurrentRule>,
  bySource: ReadonlyMap<string, CurrentRule>,
  allActive: readonly RedirectRule[],
): Promise<UndoPlan> {
  const plan: UndoPlan = {
    batchId,
    restores: [],
    deactivations: [],
    skipped: [],
    invariantViolations: [],
  };
  for (const change of changes.updated) {
    const now = byId.get(change.id);
    if (!now) {
      plan.skipped.push({
        kind: "missing",
        source: change.source,
        reason: "the rule no longer exists",
      });
      continue;
    }
    const drifted = Object.keys(change.to).filter(
      (key) => !same(now[key], change.to[key]),
    );
    if (drifted.length > 0) {
      plan.skipped.push({
        kind: "changed-since",
        source: change.source,
        reason: `changed since the batch (${drifted.join(", ")}): undo the later change first`,
      });
      continue;
    }
    plan.restores.push({
      id: change.id,
      source: change.source,
      from: change.from,
      currentDestination: now.destinationPath,
    });
  }
  for (const made of changes.created) {
    const now = bySource.get(redirectPathLower(made.source));
    if (!now) {
      plan.skipped.push({
        kind: "missing",
        source: made.source,
        reason: "the rule no longer exists",
      });
      continue;
    }
    if (
      !now.isActive ||
      redirectPathLower(now.destinationPath) !==
        redirectPathLower(made.destination)
    ) {
      plan.skipped.push({
        kind: "changed-since",
        source: made.source,
        reason: now.isActive
          ? "the destination changed since the batch: undo the later change first"
          : "the rule is already inactive",
      });
      continue;
    }
    plan.deactivations.push({
      id: now.id,
      source: made.source,
      destination: made.destination,
    });
  }
  // a visszavonás utáni állapot: a láncot semmilyen visszavonás nem hozhat létre
  const store = new MemoryRedirectStore(allActive);
  const ismert = new Set(allActive.map((r) => r.id));
  for (const restore of plan.restores)
    if (ismert.has(restore.id))
      await store.update(
        restore.id,
        restore.from as Parameters<MemoryRedirectStore["update"]>[1],
      );
  for (const off of plan.deactivations)
    if (ismert.has(off.id)) await store.update(off.id, { isActive: false });
  plan.invariantViolations = (await redirectInvariantViolations(store)).map(
    (r) => ({ source: r.sourcePath, destination: r.destinationPath }),
  );
  return plan;
}

/** A TERV LENYOMATA: a szárazfutás és az írás kapcsolata. A köteg, a visszaállítások, a kikapcsolások és a kihagyások tartoznak bele. */
export function undoPlanHash(plan: UndoPlan): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        batchId: plan.batchId,
        restores: plan.restores.map((r) => [
          r.id,
          r.from,
          r.currentDestination,
        ]),
        deactivations: plan.deactivations.map((d) => [d.id, d.destination]),
        skipped: plan.skipped.map((k) => [k.kind, k.source]),
      }),
    )
    .digest("hex");
}
