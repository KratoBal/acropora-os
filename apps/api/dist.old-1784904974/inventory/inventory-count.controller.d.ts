import { StreamableFile } from "@nestjs/common";
import { type AuthenticatedUser } from "@acropora/types";
import { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { UpdateInventoryCountLineDto } from "./dto/update-inventory-count-line.dto.js";
import { InventoryCountService } from "./inventory-count.service.js";
export declare class InventoryCountController {
    private readonly counts;
    constructor(counts: InventoryCountService);
    list(query: InventoryCountListQueryDto): Promise<import("@acropora/types").InventoryCountListResponse>;
    detail(id: string): Promise<import("@acropora/types").InventoryCountDetail>;
    create(user: AuthenticatedUser): Promise<import("@acropora/types").InventoryCountDetail>;
    downloadTemplate(id: string): Promise<StreamableFile>;
    upload(id: string, file?: Express.Multer.File): Promise<import("@acropora/types").InventoryCountUploadResult>;
    updateLine(id: string, lineId: string, dto: UpdateInventoryCountLineDto): Promise<import("@acropora/types").InventoryCountDetail>;
    apply(id: string, user: AuthenticatedUser): Promise<import("@acropora/types").InventoryCountApplyResult>;
}
