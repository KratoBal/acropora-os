import type { CreatePosSaleInput, PosSaleDetail, PosSaleListResponse, PosSaleResult } from "@acropora/types";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import { PosSaleRepository } from "./pos-sale.repository.js";
export declare class PosSaleService {
    private readonly sales;
    private readonly unasApi;
    private readonly unasAuth;
    constructor(sales: PosSaleRepository, unasApi: UnasApiClient, unasAuth: UnasAuthService);
    list(query: PosSaleListQueryDto): Promise<PosSaleListResponse>;
    getDetail(id: string): Promise<PosSaleDetail>;
    createSale(input: CreatePosSaleInput, actorUserId: string): Promise<PosSaleResult>;
}
