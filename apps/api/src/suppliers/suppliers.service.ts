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
  UpdateSupplierDto,
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
      this.map(error);
    }
  }

  async update(id: string, input: UpdateSupplierDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.update(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A beszállítót másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException("Ez a beszállítói kód már használatban van.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A beszállító nem található.");
    throw error;
  }
}
