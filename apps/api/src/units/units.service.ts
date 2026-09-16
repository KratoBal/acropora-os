import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  UnitOfMeasureKind,
  UnitOfMeasureListResponse,
} from "@acropora/types";

import type {
  CreateUnitOfMeasureDto,
  UpdateUnitOfMeasureDto,
} from "./dto/unit-of-measure.dto.js";
import {
  UnitOfMeasureDuplicateError,
  UnitOfMeasureInUseError,
  UnitsRepository,
} from "./units.repository.js";

/**
 * A HASZNALATBAN LEVO EGYSEGRE A VALASZ NEM "NEM SIKERULT", HANEM A TEENDO.
 *
 * Egy sima "nem torolheto" mondat utan a kezelo ujra megprobalja, majd feladja.
 * A kivezetes ETTOL a mondattol lesz felfedezheto -- a felulet ugyanezt a
 * gombot kinalja mellette.
 */
const HASZNALATBAN =
  "Ez a mértékegység már szerepel eszközökön, ezért nem törölhető. Vezesd ki helyette: kikerül a választóból, a meglévő értékek mellett viszont olvasható marad.";

@Injectable()
export class UnitsService {
  constructor(private readonly repository: UnitsRepository) {}

  async list(
    kind: UnitOfMeasureKind,
    includeInactive: boolean,
  ): Promise<UnitOfMeasureListResponse> {
    return { items: await this.repository.list(kind, includeInactive) };
  }

  async create(input: CreateUnitOfMeasureDto) {
    try {
      return await this.repository.create(input);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateUnitOfMeasureDto) {
    try {
      const updated = await this.repository.update(id, input);
      if (!updated)
        throw new NotFoundException("A mértékegység nem található.");
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.map(error);
    }
  }

  async remove(id: string) {
    try {
      const removed = await this.repository.remove(id);
      if (!removed)
        throw new NotFoundException("A mértékegység nem található.");
      return { ok: true } as const;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.map(error);
    }
  }

  /**
   * A KET HIBA KET KULONBOZO TEENDOT AD, EZERT KET KULONBOZO KOD.
   *
   * A duplikatum a KERES hibaja (mas kodot kell irni) -- 400. A hasznalatban
   * levo egyseg viszont NEM a keres hibaja: a keres helyes volt, csak a vilag
   * mas -- 409, es a mondat a kivezetes fele mutat.
   */
  private map(error: unknown): never {
    if (error instanceof UnitOfMeasureDuplicateError)
      throw new BadRequestException(
        "Ez a jel már szerepel ebben a fajtában. Válassz másikat, vagy nézd meg a kivezetettek között.",
      );
    if (error instanceof UnitOfMeasureInUseError)
      throw new ConflictException(HASZNALATBAN);
    throw error;
  }
}
