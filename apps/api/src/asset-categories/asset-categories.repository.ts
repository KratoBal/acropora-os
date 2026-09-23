import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AssetCategory } from "@acropora/types";

import {
  isPrismaErrorCode,
  isPrismaUniqueConstraintViolation,
} from "../common/prisma-error.util.js";
import { byHungarianName } from "../common/hungarian-name-sort.util.js";

/** A nev mar szerepel a listaban. */
export class AssetCategoryDuplicateError extends Error {}

/**
 * A KOD MAR SZEREPEL A LISTABAN -- KULON A NEV-DUPLIKATUMTOL.
 *
 * Kanban 68add892, 2026-09-22: a `code` masodik `@unique` mezo lett a tablan.
 * A ket hiba MAS mondatot erdemel (a felhasznalo mast ir at: a nevet vagy a
 * kodot), ezert nem elegendo egyetlen `AssetCategoryDuplicateError` tipus --
 * a `meta.target`-bol kell tudni, MELYIK mezo utkozott.
 */
export class AssetCategoryDuplicateCodeError extends Error {}

@Injectable()
export class AssetCategoriesRepository {
  /**
   * A SORREND MAGYAR ABC, A NEV SZERINT -- NEM A `sortOrder`.
   *
   * Balazs kerese, 2026-09-23 (kanban 8c77cf3e), szo szerint: "az eszkoz
   * felvitelnel es egyebkent a kategoria listanal a beallitasokban legyen
   * magyar ABC szerint sorrendben a lista". A `sortOrder` a FANK jelmagyarazat
   * SORRENDJET hordozta (10, 20, 30 ...), nem abc-t -- a mezo a torzsadaton
   * MARAD (nem torolt), csak a listazas tobbe nem rendez ra.
   *
   * NODE-OLDALI `localeCompare(..., "hu")`, NEM ADATBAZIS-OLDALI COLLATE.
   * Merve (murena, 2026-09-23): ebben a fejlesztoi kornyezetben nincs `psql`,
   * `createdb`/`dropdb`, es a nyers TCP kapcsolat is ECONNREFUSED-del utasitja
   * el a 127.0.0.1:5432 portot -- tehat nem volt modom lekerdezni, fut-e
   * magyar ICU kollacio (`hu-HU-x-icu`) az eles vagy akar egy szemet-
   * adatbazison. Ez MERT hiany, nem jogosultsagi korlat.
   *
   * A `localeCompare(..., "hu")` viszont MAR HASZNALT MINTA ebben a
   * repositoryban (`service-assets.repository.ts`, a tulajdonos-lista
   * rendezese), tehat nem uj dontes, hanem a MEGLEVO szabaly kovetese -- es
   * ez oldja fel a `db-oldali-e vagy node-oldali` kerdest: a kolláció
   * MEGLETE nelkul is helyesen mukodik, mert a Node ICU-ja (mert `process.
   * versions.icu`, ellenorizve) fuggetlen a Postgres peldany beallitasatol.
   */
  async list(includeInactive: boolean): Promise<AssetCategory[]> {
    const rows = await prisma.assetCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      select: {
        id: true,
        name: true,
        isActive: true,
        sortOrder: true,
        code: true,
      },
    });
    return byHungarianName(rows);
  }

  async create(input: {
    name: string;
    sortOrder: number;
    code: string | null;
  }): Promise<AssetCategory> {
    try {
      return await prisma.assetCategory.create({
        data: input,
        select: {
          id: true,
          name: true,
          isActive: true,
          sortOrder: true,
          code: true,
        },
      });
    } catch (error) {
      throw this.map(error);
    }
  }

  async update(
    id: string,
    input: {
      name?: string;
      isActive?: boolean;
      sortOrder?: number;
      code?: string | null;
    },
  ): Promise<AssetCategory | null> {
    try {
      return await prisma.assetCategory.update({
        where: { id },
        data: input,
        select: {
          id: true,
          name: true,
          isActive: true,
          sortOrder: true,
          code: true,
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2025")) return null;
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
    if (isPrismaUniqueConstraintViolation(error, "code"))
      return new AssetCategoryDuplicateCodeError();
    if (isPrismaUniqueConstraintViolation(error, "name"))
      return new AssetCategoryDuplicateError();
    return error;
  }
}
