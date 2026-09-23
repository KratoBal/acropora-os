import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  normalizeAssetCategoryCode,
  normalizeAssetCategoryName,
  type AssetCategoryListResponse,
} from "@acropora/types";

import {
  AssetCategoriesRepository,
  AssetCategoryDuplicateCodeError,
  AssetCategoryDuplicateError,
} from "./asset-categories.repository.js";
import type {
  CreateAssetCategoryDto,
  UpdateAssetCategoryDto,
} from "./dto/asset-category.dto.js";

const DUPLIKATUM =
  "Ez a kategória már szerepel a listában. Válassz másik nevet, vagy nézd meg a kivezetettek között.";
const KOD_DUPLIKATUM =
  "Ez a kód már foglalt egy másik kategóriánál. Válassz másik kódot, vagy nézd meg a kivezetettek között.";

@Injectable()
export class AssetCategoriesService {
  constructor(private readonly repository: AssetCategoriesRepository) {}

  async list(includeInactive: boolean): Promise<AssetCategoryListResponse> {
    return { items: await this.repository.list(includeInactive) };
  }

  async create(input: CreateAssetCategoryDto) {
    try {
      return await this.repository.create({
        /**
         * A NORMALIZALAS A KOZOS FUGGVENYBOL JON, nem itt all. Ugyanazt a
         * szabalyt a felulet is alkalmazza a mentes elott -- ket masolatbol
         * az egyik elobb-utobb mast csinalna, es a kulonbseg egy DUPLIKATUM
         * lenne, amit a felhasznalo nem ert.
         */
        name: normalizeAssetCategoryName(input.name),
        sortOrder: input.sortOrder ?? 0,
        code: normalizeAssetCategoryCode(input.code),
      });
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateAssetCategoryDto) {
    try {
      const updated = await this.repository.update(id, {
        ...(input.name === undefined
          ? {}
          : { name: normalizeAssetCategoryName(input.name) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.sortOrder === undefined
          ? {}
          : { sortOrder: input.sortOrder }),
        ...(input.code === undefined
          ? {}
          : { code: normalizeAssetCategoryCode(input.code) }),
      });
      if (!updated) throw new NotFoundException("A kategória nem található.");
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.map(error);
    }
  }

  /**
   * A `DELETE` KIVEZET, NEM TOROL -- es a valasz ezt KIMONDJA.
   *
   * Egy `{ ok: true }` itt azt sugallna, hogy a sor eltunt. A `retired` mezo
   * megmondja, mi tortent valojaban: a kategoria kiesik a valasztobol, de a
   * mar felvitt eszkozok mellett olvashato marad.
   */
  async retire(id: string) {
    const retired = await this.repository.retire(id);
    if (!retired) throw new NotFoundException("A kategória nem található.");
    return { retired: true } as const;
  }

  private map(error: unknown): never {
    if (error instanceof AssetCategoryDuplicateCodeError)
      throw new BadRequestException(KOD_DUPLIKATUM);
    if (error instanceof AssetCategoryDuplicateError)
      throw new BadRequestException(DUPLIKATUM);
    throw error;
  }
}
