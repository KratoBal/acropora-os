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

import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import {
  InventoryCountRepository,
  type InventoryCountLinePushResult,
} from "./inventory-count.repository.js";

@Injectable()
export class InventoryCountService {
  constructor(
    private readonly counts: InventoryCountRepository,
    private readonly xlsx: InventoryCountXlsx,
    private readonly unasApi: UnasApiClient,
    private readonly unasAuth: UnasAuthService,
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

    const changedLines = current.lines.filter(
      (line) => line.differenceQty !== null && Number(line.differenceQty) !== 0,
    );

    const pushResults = new Map<string, InventoryCountLinePushResult>();
    if (changedLines.length > 0) {
      const token = await this.unasAuth.getToken();
      for (const line of changedLines) {
        try {
          await this.unasApi.setStock(token, {
            sku: line.sku,
            qty: line.countedQty!,
            comment: `Leltár korrekció (${current.countNumber})`,
          });
          pushResults.set(line.id, {
            lineId: line.id,
            status: "OK",
            errorMessage: null,
          });
        } catch (error) {
          pushResults.set(line.id, {
            lineId: line.id,
            status: "FAILED",
            errorMessage:
              error instanceof Error ? error.message : "UNAS_PUSH_FAILED",
          });
        }
      }
    }

    const result = await this.counts.applyCorrection(
      id,
      actorUserId,
      pushResults,
    );
    return result;
  }

  private async requireCount(id: string) {
    const count = await this.counts.findById(id);
    if (!count) throw new NotFoundException("A leltár nem található.");
    return count;
  }
}
