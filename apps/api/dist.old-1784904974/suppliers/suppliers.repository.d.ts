import { Repository } from "@acropora/database";
import type { SupplierListResponse, SupplierSummary } from "@acropora/types";
import type { CreateSupplierDto, SupplierListQueryDto, UpdateSupplierDto } from "./dto/supplier.dto.js";
export declare class SuppliersRepository extends Repository {
    constructor();
    list(query: SupplierListQueryDto): Promise<SupplierListResponse>;
    detail(id: string): Promise<SupplierSummary | null>;
    create(input: CreateSupplierDto, actorId: string): Promise<SupplierSummary>;
    update(id: string, input: UpdateSupplierDto, actorId: string): Promise<SupplierSummary>;
}
