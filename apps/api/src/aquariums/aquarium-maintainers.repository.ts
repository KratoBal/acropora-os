import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AquariumMaintainer } from "@acropora/types";

import { aquariumMaintainerUserWhere } from "./aquarium-maintainer-assignment.js";

@Injectable()
export class AquariumMaintainersRepository {
  /** A választóban felkínált kollégák -- lásd `aquariumMaintainerUserWhere`. */
  async selectable(): Promise<AquariumMaintainer[]> {
    const users = await prisma.user.findMany({
      where: aquariumMaintainerUserWhere(),
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    return users.map((user) => ({
      userId: user.id,
      displayName: user.displayName,
    }));
  }

  /** Melyik a küldött azonosítók közül VÁLASZTHATÓ ténylegesen -- a hívó
   * ebből dönti el, mit utasít el. Ugyanaz a minta, mint
   * `WorksheetsRepository.assignableUserIds`. */
  async selectableUserIds(ids: readonly string[]): Promise<Set<string>> {
    const rows = await prisma.user.findMany({
      where: { id: { in: [...ids] }, ...aquariumMaintainerUserWhere() },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * A KARBANTARTÓ-LISTA TELJES CSERÉJE, EGY TRANZAKCIÓBAN.
   *
   * Csere, nem hozzáadás/eltávolítás -- a felület egyetlen "mentés" gombbal
   * a teljes, kívánt végállapotot küldi, ugyanúgy, mint a munkalap
   * felelős-listájánál (`setAssignees`).
   */
  async set(aquariumId: string, userIds: readonly string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    await prisma.$transaction([
      prisma.aquariumMaintainer.deleteMany({ where: { aquariumId } }),
      ...(unique.length > 0
        ? [
            prisma.aquariumMaintainer.createMany({
              data: unique.map((userId) => ({ aquariumId, userId })),
            }),
          ]
        : []),
    ]);
  }
}
