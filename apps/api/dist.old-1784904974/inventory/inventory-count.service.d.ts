import type { InventoryCountApplyResult, InventoryCountDetail, InventoryCountUploadResult } from "@acropora/types";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountRepository } from "./inventory-count.repository.js";
export declare class InventoryCountService {
    private readonly counts;
    private readonly xlsx;
    private readonly unasApi;
    private readonly unasAuth;
    constructor(counts: InventoryCountRepository, xlsx: InventoryCountXlsx, unasApi: UnasApiClient, unasAuth: UnasAuthService);
    list(query: InventoryCountListQueryDto): Promise<import("@acropora/types").InventoryCountListResponse>;
    getDetail(id: string): Promise<InventoryCountDetail>;
    createCount(actorUserId: string): Promise<InventoryCountDetail>;
    exportTemplate(id: string): Promise<{
        filename: string;
        buffer: Buffer;
    }>;
    uploadCounts(id: string, file: Buffer): Promise<InventoryCountUploadResult>;
    updateLineCount(id: string, lineId: string, countedQty: number): Promise<InventoryCountDetail>;
    applyCorrection(id: string, actorUserId: string): Promise<InventoryCountApplyResult>;
    private requireCount;
}
