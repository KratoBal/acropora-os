import { type AuthenticatedUser } from "@acropora/types";
import { CreatePosSaleDto } from "./dto/create-pos-sale.dto.js";
import { PosProductSearchQueryDto } from "./dto/pos-product-search-query.dto.js";
import { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleService } from "./pos-sale.service.js";
export declare class PosController {
    private readonly search;
    private readonly sales;
    constructor(search: PosProductSearchService, sales: PosSaleService);
    searchProducts(query: PosProductSearchQueryDto): Promise<import("@acropora/types").PosProductSearchResult[]>;
    listSales(query: PosSaleListQueryDto): Promise<import("@acropora/types").PosSaleListResponse>;
    getSale(id: string): Promise<import("@acropora/types").PosSaleDetail>;
    createSale(dto: CreatePosSaleDto, user: AuthenticatedUser): Promise<import("@acropora/types").PosSaleResult>;
}
