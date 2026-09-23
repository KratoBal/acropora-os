import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  normalizeAssetFunctionName,
  type AssetFunctionListResponse,
} from "@acropora/types";

import {
  AssetFunctionsRepository,
  AssetFunctionDuplicateError,
} from "./asset-functions.repository.js";
import type {
  CreateAssetFunctionDto,
  UpdateAssetFunctionDto,
} from "./dto/asset-function.dto.js";

const DUPLIKATUM =
  "Ez a funkció már szerepel a listában. Válassz másik nevet, vagy nézd meg a kivezetettek között.";

@Injectable()
export class AssetFunctionsService {
  constructor(private readonly repository: AssetFunctionsRepository) {}

  async list(includeInactive: boolean): Promise<AssetFunctionListResponse> {
    return { items: await this.repository.list(includeInactive) };
  }

  async create(input: CreateAssetFunctionDto) {
    try {
      return await this.repository.create({
        name: normalizeAssetFunctionName(input.name),
        sortOrder: input.sortOrder ?? 0,
      });
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateAssetFunctionDto) {
    try {
      const updated = await this.repository.update(id, {
        ...(input.name === undefined
          ? {}
          : { name: normalizeAssetFunctionName(input.name) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.sortOrder === undefined
          ? {}
          : { sortOrder: input.sortOrder }),
      });
      if (!updated) throw new NotFoundException("A funkció nem található.");
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.map(error);
    }
  }

  /** A `DELETE` KIVEZET, NEM TOROL -- ugyanaz az indok, mint a kategorianal. */
  async retire(id: string) {
    const retired = await this.repository.retire(id);
    if (!retired) throw new NotFoundException("A funkció nem található.");
    return { retired: true } as const;
  }

  private map(error: unknown): never {
    if (error instanceof AssetFunctionDuplicateError)
      throw new BadRequestException(DUPLIKATUM);
    throw error;
  }
}
