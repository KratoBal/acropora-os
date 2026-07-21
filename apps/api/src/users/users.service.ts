import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { UsersRepository } from "./users.repository.js";
import type {
  CreateUserDto,
  SetUserPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user.dto.js";

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  list(query: UserListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const user = await this.repository.detail(id);
    if (!user) throw new NotFoundException("A felhasználó nem található.");
    return user;
  }

  async create(input: CreateUserDto, actorId: string) {
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateUserDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.update(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async setPassword(id: string, input: SetUserPasswordDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.setPassword(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async activate(id: string, actorId: string) {
    const user = await this.detail(id);
    if (user.isActive) return user;
    try {
      return await this.repository.setActive(id, true, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async deactivate(id: string, actorId: string) {
    if (id === actorId)
      throw new BadRequestException(
        "Saját magadat nem tudod inaktiválni. Kérj meg egy másik adminisztrátort.",
      );
    const user = await this.detail(id);
    if (!user.isActive) return user;
    try {
      return await this.repository.setActive(id, false, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A felhasználót másik adminisztrátor módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException("Ez az e-mail cím már használatban van.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A felhasználó nem található.");
    throw error;
  }
}
