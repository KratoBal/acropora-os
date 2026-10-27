import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

/** A kedvencek tárolója: egy felhasználó útvonalai, a megjelölés sorrendjében. */
@Injectable()
export class FavoritesRepository {
  async list(userId: string): Promise<string[]> {
    const rows = await prisma.userFavorite.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { href: true },
    });
    return rows.map((row) => row.href);
  }

  /**
   * IDEMPOTENS: a már meglévő sor érintetlen marad (a megjelölés ideje és így a
   * sorrend nem változik), és két párhuzamos kattintás sem hibázik az egyedi
   * kulcson.
   */
  async add(userId: string, href: string): Promise<void> {
    await prisma.userFavorite.upsert({
      where: { userId_href: { userId, href } },
      create: { userId, href },
      update: {},
    });
  }

  /** `deleteMany`: ami nincs, azt nem kell kivenni, és ez nem hiba. */
  async remove(userId: string, href: string): Promise<void> {
    await prisma.userFavorite.deleteMany({ where: { userId, href } });
  }
}
