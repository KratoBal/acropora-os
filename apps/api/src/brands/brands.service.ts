import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { BrandsRepository } from "./brands.repository.js";
import type {
  BrandAliasDto,
  BrandListQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from "./dto/brand.dto.js";

@Injectable()
export class BrandsService {
  constructor(private readonly repository: BrandsRepository) {}
  list(query: BrandListQueryDto) {
    return this.repository.list(query);
  }
  async detail(id: string) {
    const brand = await this.repository.detail(id);
    if (!brand) throw new NotFoundException("A márka nem található.");
    return brand;
  }
  async create(input: CreateBrandDto, actorId: string) {
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async update(id: string, input: UpdateBrandDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.update(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async archive(id: string, actorId: string) {
    const brand = await this.detail(id);
    if (!brand.isActive) return brand;
    try {
      return await this.repository.setArchived(id, true, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async restore(id: string, actorId: string) {
    const brand = await this.detail(id);
    if (brand.isActive) return brand;
    try {
      return await this.repository.setArchived(id, false, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async addAlias(id: string, input: BrandAliasDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.addAlias(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async updateAlias(
    id: string,
    aliasId: string,
    input: BrandAliasDto,
    actorId: string,
  ) {
    await this.detail(id);
    try {
      return await this.repository.updateAlias(id, aliasId, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  async removeAlias(id: string, aliasId: string, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.removeAlias(id, aliasId, actorId);
    } catch (error) {
      this.map(error);
    }
  }
  private map(error: unknown): never {
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A márkát másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (error instanceof Error && error.message === "CANONICAL_ALIAS")
      throw new BadRequestException("A kanonikus név nem szükséges aliasként.");
    if (error instanceof Error && error.message === "IDENTITY_CONFLICT")
      throw new ConflictException(
        "A normalizált identitást már egy másik kanonikus név vagy alias használja.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "A normalizált márkanév, slug, alias vagy külső mapping már használatban van.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A márka vagy alias nem található.");
    throw error;
  }
}
