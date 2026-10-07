import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  PermissionOverride,
  PermissionOverrideEffect,
  UserRole,
} from "@acropora/types";

export interface PermissionTargetRow {
  id: string;
  role: UserRole;
  customerId: string | null;
  supplierId: string | null;
  permissionOverrides: {
    permission: string;
    effect: PermissionOverrideEffect;
  }[];
}

/** A felhasználónkénti jog-eltérések tárolása (`UserPermissionOverride`). */
@Injectable()
export class UserPermissionsRepository {
  private readonly database = prisma;

  target(id: string): Promise<PermissionTargetRow | null> {
    return this.database.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        customerId: true,
        supplierId: true,
        permissionOverrides: { select: { permission: true, effect: true } },
      },
    });
  }

  /**
   * A TELJES LISTA CSERÉJE, NAPLÓVAL, EGY TRANZAKCIÓBAN. A napló a korábbi és
   * az új eltéréseket, és a ténylegesen nyert és elvesztett jogokat is viszi:
   * egy utólagos kérdés („mióta látja X a pénzügyet?”) a naplóból
   * megválaszolható legyen, ne kelljen két listát összevetni.
   */
  async replace(input: {
    userId: string;
    actorId: string;
    before: PermissionOverride[];
    after: PermissionOverride[];
    gained: string[];
    lost: string[];
  }): Promise<void> {
    await this.database.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({
        where: { userId: input.userId },
      });
      if (input.after.length)
        await tx.userPermissionOverride.createMany({
          data: input.after.map((override) => ({
            userId: input.userId,
            permission: override.permission,
            effect: override.effect,
            setById: input.actorId,
          })),
        });
      const metadata = {
        before: input.before,
        after: input.after,
        gained: input.gained,
        lost: input.lost,
      } as unknown as Prisma.JsonObject;
      await tx.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "user.permissions-changed",
          aggregateType: "User",
          aggregateId: input.userId,
          actorUserId: input.actorId,
          payload: metadata,
          occurredAt: new Date(),
          schemaVersion: 1,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorId,
          action: "user.permissions-changed",
          entityType: "User",
          entityId: input.userId,
          metadata,
        },
      });
    });
  }
}
