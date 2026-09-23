import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { AssetFunction } from "@acropora/types";

import { byHungarianName } from "../common/hungarian-name-sort.util.js";

/** A nev mar szerepel a listaban. */
export class AssetFunctionDuplicateError extends Error {}

/**
 * AZ ESZKOZ-FUNKCIO TORZSADAT TAROLOJA -- SZO SZERINT AZ
 * `AssetCategoriesRepository` SZERKEZETE, mas tablan.
 *
 * NINCS `code` MEZO: azt csak az AssetCategory kapta (kanban 68add892, 1.
 * resz). FUGGETLEN torzsadat, nincs kozottuk kapcsolat.
 */
@Injectable()
export class AssetFunctionsRepository {
  /**
   * A SORREND MAGYAR ABC, A NEV SZERINT -- SZO SZERINT AZ
   * `AssetCategoriesRepository.list` FEJLECE, mas tablan. Kanban 8c77cf3e,
   * 2026-09-23: itt eddig is `name: "asc"` volt a masodlagos rendezes, csak
   * DB-oldali osszehasonlitassal, ami az ekezetes betuket a sor VEGERE tette
   * -- ezert latszott ugy, hogy "mar abc-ben van, csak az ekezetek nincsenek
   * a helyukon".
   */
  async list(includeInactive: boolean): Promise<AssetFunction[]> {
    const rows = await prisma.assetFunction.findMany({
      where: includeInactive ? {} : { isActive: true },
      select: { id: true, name: true, isActive: true, sortOrder: true },
    });
    return byHungarianName(rows);
  }

  async create(input: {
    name: string;
    sortOrder: number;
  }): Promise<AssetFunction> {
    try {
      return await prisma.assetFunction.create({
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
  ): Promise<AssetFunction | null> {
    try {
      return await prisma.assetFunction.update({
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
   * A TORLES KIVEZETES, NEM TORLES -- ugyanaz az indok, mint a kategorianal:
   * eszkozok hivatkoznak a sorra (`Restrict`).
   */
  async retire(id: string): Promise<boolean> {
    const changed = await prisma.assetFunction.updateMany({
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
      return new AssetFunctionDuplicateError();
    return error;
  }
}
