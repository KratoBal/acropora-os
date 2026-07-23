import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { SuppliersRepository } from "./suppliers.repository.js";
import type {
  CreateSupplierDto,
  SupplierListQueryDto,
} from "./dto/supplier.dto.js";

@Injectable()
export class SuppliersService {
  constructor(private readonly repository: SuppliersRepository) {}

  list(query: SupplierListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const supplier = await this.repository.detail(id);
    if (!supplier) throw new NotFoundException("A beszállító nem található.");
    return supplier;
  }

  async create(input: CreateSupplierDto, actorId: string) {
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "Ez a beszállítói kód már használatban van.",
        );
      throw error;
    }
  }
}
