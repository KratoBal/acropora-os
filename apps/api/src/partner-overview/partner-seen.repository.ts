import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { PartnerSeenArea } from "@acropora/types";

/** THE PARTNER'S LAST VISIT OF A LIST (card 28f31715, PR 2): one row per user and area, the list's opening writes it. */
@Injectable()
export class PartnerSeenRepository {
  private readonly database = prisma;

  async lastSeen(
    userId: string,
  ): Promise<Partial<Record<PartnerSeenArea, Date>>> {
    const rows = await this.database.partnerSeen.findMany({
      where: { userId },
      select: { area: true, lastSeenAt: true },
    });
    return Object.fromEntries(rows.map((row) => [row.area, row.lastSeenAt]));
  }

  async markSeen(
    userId: string,
    area: PartnerSeenArea,
    at: Date,
  ): Promise<void> {
    await this.database.partnerSeen.upsert({
      where: { userId_area: { userId, area } },
      create: { userId, area, lastSeenAt: at },
      update: { lastSeenAt: at },
    });
  }
}
