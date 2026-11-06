import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  normalizeOptionalRentalText,
  type RentalEquipmentListResponse,
} from "@acropora/types";

import type {
  CreateRentalEquipmentDto,
  UpdateRentalEquipmentDto,
} from "./dto/rental-equipment.dto.js";
import {
  RentalEquipmentDuplicateSerialError,
  RentalEquipmentRepository,
  type RentalEquipmentWrite,
} from "./rental-equipment.repository.js";

const DUPLICATE_SERIAL =
  "Ez a gyári szám már egy másik eszközön szerepel. Nézd meg a kivezetettek között is.";
const NOT_FOUND = "Az eszköz nem található.";
const EMPTY_NAME = "Az eszköz nevét meg kell adni.";

@Injectable()
export class RentalEquipmentService {
  constructor(private readonly repository: RentalEquipmentRepository) {}

  async list(includeInactive: boolean): Promise<RentalEquipmentListResponse> {
    return { items: await this.repository.list(includeInactive) };
  }

  async create(input: CreateRentalEquipmentDto) {
    const name = input.name.trim();
    if (name === "") throw new BadRequestException(EMPTY_NAME);
    try {
      return await this.repository.create({
        name,
        serialNumber: normalizeOptionalRentalText(input.serialNumber),
        dailyFeeHuf: input.dailyFeeHuf,
        depositHuf: input.depositHuf,
        replacementValueHuf: input.replacementValueHuf,
        accessories: normalizeOptionalRentalText(input.accessories),
        note: normalizeOptionalRentalText(input.note),
      });
    } catch (error) {
      this.map(error);
    }
  }

  /** Only the fields present in the request are written; `null` clears an optional text field. */
  async update(id: string, input: UpdateRentalEquipmentDto) {
    const data: Partial<RentalEquipmentWrite> & { isActive?: boolean } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name === "") throw new BadRequestException(EMPTY_NAME);
      data.name = name;
    }
    for (const key of ["serialNumber", "accessories", "note"] as const)
      if (input[key] !== undefined)
        data[key] = normalizeOptionalRentalText(input[key]);
    for (const key of [
      "dailyFeeHuf",
      "depositHuf",
      "replacementValueHuf",
    ] as const)
      if (input[key] !== undefined) data[key] = input[key];
    if (input.isActive !== undefined) data.isActive = input.isActive;

    try {
      const updated = await this.repository.update(id, data);
      if (!updated) throw new NotFoundException(NOT_FOUND);
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof RentalEquipmentDuplicateSerialError)
      throw new BadRequestException(DUPLICATE_SERIAL);
    throw error;
  }
}
