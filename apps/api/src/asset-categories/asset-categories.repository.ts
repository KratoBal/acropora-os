import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { AssetCategory } from "@acropora/types";

/** A nev mar szerepel a listaban. */
export class AssetCategoryDuplicateError extends Error {}

@Injectable()
export class AssetCategoriesRepository {
  async list(includeInactive: boolean): Promise<AssetCategory[]> {
    return prisma.assetCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      /**
       * A SORREND DETERMINALT: a `sortOrder` dont, azonos ertek mellett a NEV,
       * es vegul az azonosito. Ket szint nem eleg -- ket azonos nevu kategoria
       * ugyan nem lehet (egyedi), de a `sortOrder` alapertelmezese NULLA, tehat
       * a kezzel felvett elemek mind ugyanoda esnek.
       */
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, isActive: true, sortOrder: true },
    });
  }

  async create(input: {
    name: string;
    sortOrder: number;
  }): Promise<AssetCategory> {
    try {
      return await prisma.assetCategory.create({
        data: input,
        select: { id: true, name: true, isActive: true, sortOrder: true },
      });
    } catch (error) {
      throw this.map(error);
    }
  }

  async update(
    id: string,
    input: { name?: string; isActive?: boolean; sortOrder?: number },
  ): Promise<AssetCategory | null> {
    try {
      return await prisma.assetCategory.update({
        where: { id },
        data: input,
        select: { id: true, name: true, isActive: true, sortOrder: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      )
        return null;
      throw this.map(error);
    }
  }

  /**
   * A TORLES KIVEZETES, NEM TORLES.
   *
   * Eszkozok hivatkoznak a sorra (`Restrict`), tehat egy valodi `DELETE` vagy
   * elhasalna, vagy -- ha eppen senki nem hivatkozik ra -- eltuntetne a nevet
   * a mar kiirt sorok alol. A kivezetes mind a kettot elkeruli, es
   * visszafordithato.
   */
  async retire(id: string): Promise<boolean> {
    const changed = await prisma.assetCategory.updateMany({
      where: { id },
      data: { isActive: false },
    });
    return changed.count === 1;
  }

  private map(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return new AssetCategoryDuplicateError();
    return error;
  }
}
