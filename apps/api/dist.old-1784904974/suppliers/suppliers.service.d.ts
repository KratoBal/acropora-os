import { SuppliersRepository } from "./suppliers.repository.js";
import type { CreateSupplierDto, SupplierListQueryDto, UpdateSupplierDto } from "./dto/supplier.dto.js";
export declare class SuppliersService {
    private readonly repository;
    constructor(repository: SuppliersRepository);
    list(query: SupplierListQueryDto): Promise<import("@acropora/types").SupplierListResponse>;
    detail(id: string): Promise<import("@acropora/types").SupplierSummary>;
    create(input: CreateSupplierDto, actorId: string): Promise<import("@acropora/types").SupplierSummary>;
    update(id: string, input: UpdateSupplierDto, actorId: string): Promise<import("@acropora/types").SupplierSummary>;
    private map;
}
