import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  POS_INTERNAL_USE_NOTE_MAX,
  type CreatePosInternalUseInput,
  type PosInternalUseDetail,
  type PosInternalUseListResponse,
  type PosInternalUseResult,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import {
  PosInternalUseRepository,
  type CreatePosInternalUseLine,
} from "./pos-internal-use.repository.js";
import { PosSaleRepository } from "./pos-sale.repository.js";

/**
 * A POS „BELSŐ FELHASZNÁLÁS” (Balázs, 2026-11-20 15:10 UTC, kártya ec51e614): „amit leveszünk a polcról magunknak”, egy
 * kötelező megjegyzéssel, hogy miért. NEM eladás: nincs fizetési mód, ár, nyugta, számla, és nem `SalesOrder`, ezért a POS
 * összesítő és a kassza nem látja. A termékek ugyanúgy oldódnak fel, mint az eladásnál (`PosSaleRepository.currentStock`:
 * UNAS-katalógus, csomagtermék összetevői), és ugyanazokkal az elutasításokkal; a készlet ugyanazon az úton csökken.
 *
 * AZ ÉRTÉK BESZERZÉSI ÁRON (nettó HUF), a rögzítés pillanatában rögzítve: az árajánlat `snapshotCost` szabálya (az utolsó
 * könyvelt beszerzési sor, tartalékként a termék utolsó beszerzési ára), csomagterméknél az összetevőkből. Ha egy tételnek
 * nincs ára, a tétel ára és az összérték is üres marad, nem nulla: egy nulla ár hamisan kis értéket mutatna.
 */
@Injectable()
export class PosInternalUseService {
  constructor(
    private readonly sales: PosSaleRepository,
    private readonly internalUses: PosInternalUseRepository,
  ) {}

  list(query: PosSaleListQueryDto): Promise<PosInternalUseListResponse> {
    return this.internalUses.list(query);
  }

  async getDetail(id: string): Promise<PosInternalUseDetail> {
    const detail = await this.internalUses.findById(id);
    if (!detail)
      throw new NotFoundException("A belső felhasználás nem található.");
    return detail;
  }

  async create(
    input: CreatePosInternalUseInput,
    actorUserId: string,
  ): Promise<PosInternalUseResult> {
    const note = input.note.trim();
    if (!note)
      throw new BadRequestException(
        "A megjegyzés kötelező: írd be, miért vették ki a terméket.",
      );
    if (note.length > POS_INTERNAL_USE_NOTE_MAX)
      throw new BadRequestException(
        `A megjegyzés legfeljebb ${POS_INTERNAL_USE_NOTE_MAX} karakter lehet.`,
      );
    if (input.lines.length === 0)
      throw new BadRequestException("Legalább egy tétel szükséges.");

    // the same product twice is one line (as at checkout)
    const quantities = new Map<string, number>();
    for (const line of input.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0)
        throw new BadRequestException("Érvénytelen mennyiség.");
      quantities.set(
        line.variantId,
        (quantities.get(line.variantId) ?? 0) + line.quantity,
      );
    }

    const { warehouseId, variants } = await this.sales.currentStock([
      ...quantities.keys(),
    ]);
    const resolved = [...quantities].map(([variantId, quantity]) => {
      const info = variants.get(variantId);
      if (!info)
        throw new BadRequestException(`Ismeretlen termék: ${variantId}.`);
      if (!info.syncToUnas)
        throw new BadRequestException(
          `A helyi Acropora OS-termék POS-kezelése még nincs engedélyezve: ${info.sku}.`,
        );
      if (info.stockComponents.length === 0)
        throw new BadRequestException(
          `A csomagtermék összetevői nem oldhatók fel biztonságosan: ${info.sku}.`,
        );
      return { info, quantity: new Prisma.Decimal(quantity) };
    });

    const costs = await this.internalUses.unitCosts(
      resolved.flatMap(({ info }) =>
        info.stockComponents.map((component) => component.variantId),
      ),
    );
    const lines: CreatePosInternalUseLine[] = resolved.map(
      ({ info, quantity }) => {
        let unitCost: Prisma.Decimal | null = new Prisma.Decimal(0);
        for (const component of info.stockComponents) {
          const cost = costs.get(component.variantId) ?? null;
          unitCost =
            unitCost === null || cost === null
              ? null
              : unitCost.plus(cost.times(component.quantityPerSale));
        }
        return {
          variantId: info.variantId,
          sku: info.sku,
          productName: info.productName,
          unit: info.unit,
          quantity,
          unitCost,
          stockComponents: info.stockComponents,
        };
      },
    );
    const totalCost = lines.every((line) => line.unitCost !== null)
      ? lines.reduce(
          (sum, line) => sum.plus(line.unitCost!.times(line.quantity)),
          new Prisma.Decimal(0),
        )
      : null;

    return withUniqueCode({ prefix: "BFH", field: "number" }, (number) =>
      this.internalUses.create({
        number,
        warehouseId,
        actorUserId,
        note,
        totalCost,
        lines,
      }),
    );
  }
}
