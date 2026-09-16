import { Injectable } from "@nestjs/common";

import { Prisma, prisma } from "@acropora/database";
import type { UnitOfMeasure, UnitOfMeasureKind } from "@acropora/types";

import type {
  CreateUnitOfMeasureDto,
  UpdateUnitOfMeasureDto,
} from "./dto/unit-of-measure.dto.js";

/** A hasznalatban levo egyseg torlese elakad az idegen kulcson. */
export class UnitOfMeasureInUseError extends Error {
  constructor(readonly id: string) {
    super(`UNIT_OF_MEASURE_IN_USE:${id}`);
  }
}

/** Ugyanaz a kod ugyanabban a fajtaban mar all. */
export class UnitOfMeasureDuplicateError extends Error {
  constructor(readonly code: string) {
    super(`UNIT_OF_MEASURE_DUPLICATE:${code}`);
  }
}

function sorbol(row: {
  id: string;
  code: string;
  name: string;
  kind: UnitOfMeasureKind;
  isActive: boolean;
  sortOrder: number;
}): UnitOfMeasure {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

const VALASZTAS = {
  id: true,
  code: true,
  name: true,
  kind: true,
  isActive: true,
  sortOrder: true,
} as const;

@Injectable()
export class UnitsRepository {
  /**
   * A RENDEZES KETSZINTU, ES A MASODIK SZINT NEM DISZ: a `sortOrder`
   * alapertelmezese nulla, tehat frissen felvitt egysegeknel MINDEGYIK nulla.
   * Masodik kulcs nelkul a sorrend olyankor az adatbazisra lenne bizva, es
   * ket egymas utani lekerdezes MAS sorrendet adhatna -- a kezelo pedig azt
   * hinne, hogy a lista "ugral".
   */
  async list(
    kind: UnitOfMeasureKind,
    includeInactive: boolean,
  ): Promise<UnitOfMeasure[]> {
    const rows = await prisma.unitOfMeasure.findMany({
      where: { kind, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: VALASZTAS,
    });
    return rows.map(sorbol);
  }

  async create(input: CreateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    try {
      const row = await prisma.unitOfMeasure.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          kind: input.kind,
          sortOrder: input.sortOrder ?? 0,
        },
        select: VALASZTAS,
      });
      return sorbol(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new UnitOfMeasureDuplicateError(input.code);
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateUnitOfMeasureDto,
  ): Promise<UnitOfMeasure | null> {
    try {
      const row = await prisma.unitOfMeasure.update({
        where: { id },
        data: {
          code: input.code?.trim(),
          name: input.name?.trim(),
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        },
        select: VALASZTAS,
      });
      return sorbol(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") return null;
        if (error.code === "P2002")
          throw new UnitOfMeasureDuplicateError(input.code ?? "");
      }
      throw error;
    }
  }

  /**
   * A TORLES CSAK A SOHA NEM HASZNALT EGYSEGRE MEGY, es ezt NEM elozetes
   * olvasas donti el, hanem maga az idegen kulcs (`onDelete: Restrict`).
   *
   * Egy "hasznaljak-e mar" lekerdezes csak HINNI tudna: a ket lepes kozott
   * eltelik ido, es kozben valaki ki tudja valasztani. Igy viszont a torles
   * vagy vegigmegy, vagy elhasal -- kozteset nincs.
   */
  async remove(id: string): Promise<boolean> {
    try {
      await prisma.unitOfMeasure.delete({ where: { id } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") return false;
        if (error.code === "P2003") throw new UnitOfMeasureInUseError(id);
      }
      throw error;
    }
  }
}
