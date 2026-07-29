import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  InventoryCountApplyResult,
  InventoryCountDetail,
  InventoryCountUploadResult,
} from "@acropora/types";

import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountRepository } from "./inventory-count.repository.js";

@Injectable()
export class InventoryCountService {
  constructor(
    private readonly counts: InventoryCountRepository,
    private readonly xlsx: InventoryCountXlsx,
  ) {}

  list(query: InventoryCountListQueryDto) {
    return this.counts.list(query);
  }

  async getDetail(id: string) {
    return this.requireCount(id);
  }

  createCount(actorUserId: string) {
    return this.counts.create(actorUserId);
  }

  async exportTemplate(
    id: string,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const detail = await this.requireCount(id);
    const buffer = await this.xlsx.buildTemplate(detail);
    return { filename: `${detail.countNumber}.xlsx`, buffer };
  }

  async uploadCounts(
    id: string,
    file: Buffer,
  ): Promise<InventoryCountUploadResult> {
    const current = await this.requireCount(id);
    if (current.status === "CORRECTED") {
      throw new ConflictException(
        "A leltár már le lett zárva, nem tölthető fel újra.",
      );
    }
    const { rows } = await this.xlsx.parseUpload(file);
    const { detail, unmatchedSkus } = await this.counts.markUploaded(
      id,
      rows.map((row) => ({ sku: row.sku, countedQty: row.countedQty })),
    );
    const rowBySku = new Map(rows.map((row) => [row.sku, row.sourceRowNumber]));
    return {
      detail,
      unmatchedRows: unmatchedSkus.map((sku) => ({
        sku,
        row: rowBySku.get(sku) ?? 0,
      })),
    };
  }

  async updateLineCount(
    id: string,
    lineId: string,
    countedQty: number,
  ): Promise<InventoryCountDetail> {
    const current = await this.requireCount(id);
    if (current.status === "CORRECTED") {
      throw new ConflictException(
        "A leltár már le lett zárva, a mennyiségek nem módosíthatók.",
      );
    }
    const line = current.lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new NotFoundException("A leltár tétel nem található.");
    }
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      throw new BadRequestException("A leltározott mennyiség érvénytelen.");
    }
    return this.counts.updateLineCount(id, lineId, String(countedQty));
  }

  // A tényleges készletkönyvelés (StockMovement/StockItem/UnasStockSyncOutbox)
  // teljes egészében a repository egyetlen tranzakciójában, a közös
  // postInventoryMovement-en keresztül történik - lásd
  // inventory-count.repository.ts applyCorrection(). A UNAS-push innentől
  // MINDIG a háttér-worker feladata (lásd
  // unas-stock-sync-outbox.{service,scheduler}.ts), nem ez a szolgáltatás -
  // ezért ennek már nincs szüksége UnasApiClient/UnasAuthService
  // függőségre.
  async applyCorrection(
    id: string,
    actorUserId: string,
  ): Promise<InventoryCountApplyResult> {
    const current = await this.requireCount(id);
    if (current.status === "DRAFT") {
      throw new ConflictException(
        "A leltár még nincs feltöltve, korrekció nem indítható.",
      );
    }
    if (current.status === "CORRECTED") {
      throw new ConflictException("A leltár korrekciója már megtörtént.");
    }
    if (current.lines.some((line) => line.countedQty === null)) {
      throw new BadRequestException(
        "Minden termékhez meg kell adni a leltározott mennyiséget a korrekció indítása előtt.",
      );
    }

    return this.counts.applyCorrection(id, actorUserId);
  }

  private async requireCount(id: string) {
    const count = await this.counts.findById(id);
    if (!count) throw new NotFoundException("A leltár nem található.");
    return count;
  }
}
