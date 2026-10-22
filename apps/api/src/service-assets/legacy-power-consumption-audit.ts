import { Logger } from "@nestjs/common";

import { prisma } from "@acropora/database";

/**
 * THE COUNT BEHIND THE 2026-12-31 DELETION OF THE RETIRED `powerConsumption`
 * KEY (kanban b9191d3a; acrobot, 2026-10-22, message 35157).
 *
 * The DTO still ACCEPTS the old kW key and the repository drops it, so an
 * installed old mobile build, or a write queued offline before the update,
 * gets a 2xx. Whether anything still sends it is not visible from the
 * repository, and a log line would not answer it either: the gate's `app-log`
 * reads the last lines of the CURRENT container, and every deployment starts a
 * new one. So the fact is written to `AuditLog`, which is a table, is never
 * pruned, and needs no migration.
 *
 * WHAT IS WRITTEN: only the FACT. Which branch (create or update), the asset,
 * the actor, and the client's `User-Agent` (cut to 160 characters). The VALUE
 * the client sent is never written; neither is the request body.
 *
 * THERE IS NO APP-VERSION HEADER in the mobile client today, so the
 * `User-Agent` is the only build signal the server has. If December's count is
 * not zero and the `User-Agent` does not say which build it is, that is the
 * next thing to add (a header in `apps/mobile/src/lib/api/client.ts`); an OLD
 * build cannot send it, so it would only identify the NEW ones.
 *
 * It is best effort: a failed write is logged and swallowed, because the
 * request itself already succeeded and a counter must not turn it into a 500.
 */
export const LEGACY_POWER_CONSUMPTION_DROPPED_ACTION =
  "asset.legacy-power-consumption-dropped";

const logger = new Logger("LegacyPowerConsumptionAudit");

const USER_AGENT_LIMIT = 160;

/** True when the request body carries the retired key (any value, `null` included). */
export function carriesLegacyPowerConsumption(input: object): boolean {
  return (
    (input as { powerConsumption?: unknown }).powerConsumption !== undefined
  );
}

export async function recordDroppedLegacyPowerConsumption(
  branch: "create" | "update",
  actorUserId: string,
  assetId: string,
  userAgent: string | undefined,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: LEGACY_POWER_CONSUMPTION_DROPPED_ACTION,
        entityType: "Asset",
        entityId: assetId,
        metadata: {
          branch,
          userAgent: userAgent ?? null,
          sent: "0.75",
        },
      },
    });
  } catch (error) {
    logger.warn(
      `A regi powerConsumption kulcs eldobasanak naplozasa kimaradt: ${
        error instanceof Error ? error.message : "ismeretlen hiba"
      }`,
    );
  }
}
