import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { CustomersRepository } from "./customers.repository.js";
import type {
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  list(query: CustomerListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const customer = await this.repository.detail(id);
    if (!customer) throw new NotFoundException("A vevő nem található.");
    return customer;
  }

  async create(input: CreateCustomerDto, actorId: string) {
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateCustomerDto, actorId: string) {
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
        "A vevőt másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "A partnerkód vagy egy megadott azonosító már használatban van.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A vevő nem található.");
    throw error;
  }
}
