import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { RentalEquipment } from "@acropora/types";

import { byHungarianName } from "../common/hungarian-name-sort.util.js";

/** The serial number is already on another device. */
export class RentalEquipmentDuplicateSerialError extends Error {}

export type RentalEquipmentWrite = {
  name: string;
  serialNumber: string | null;
  dailyFeeHuf: number;
  depositHuf: number;
  replacementValueHuf: number;
  accessories: string | null;
  note: string | null;
};

const SELECT = {
  id: true,
  name: true,
  serialNumber: true,
  dailyFeeHuf: true,
  depositHuf: true,
  replacementValueHuf: true,
  accessories: true,
  note: true,
  isActive: true,
} as const;

@Injectable()
export class RentalEquipmentRepository {
  /** Hungarian alphabetical order by name (the DB collation would put accented letters at the end). */
  async list(includeInactive: boolean): Promise<RentalEquipment[]> {
    const rows = await prisma.rentalEquipment.findMany({
      where: includeInactive ? {} : { isActive: true },
      select: SELECT,
    });
    return byHungarianName(rows);
  }

  async create(input: RentalEquipmentWrite): Promise<RentalEquipment> {
    try {
      return await prisma.rentalEquipment.create({
        data: input,
        select: SELECT,
      });
    } catch (error) {
      throw this.map(error);
    }
  }

  async update(
    id: string,
    input: Partial<RentalEquipmentWrite> & { isActive?: boolean },
  ): Promise<RentalEquipment | null> {
    try {
      return await prisma.rentalEquipment.update({
        where: { id },
        data: input,
        select: SELECT,
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

  private map(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return new RentalEquipmentDuplicateSerialError();
    return error;
  }
}
