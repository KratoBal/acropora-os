import { type AuthenticatedUser } from "@acropora/types";
import { CreateSupplierDto, SupplierListQueryDto, UpdateSupplierDto } from "./dto/supplier.dto.js";
import { SuppliersService } from "./suppliers.service.js";
export declare class SuppliersController {
    private readonly service;
    constructor(service: SuppliersService);
    list(query: SupplierListQueryDto): Promise<import("@acropora/types").SupplierListResponse>;
    detail(id: string): Promise<import("@acropora/types").SupplierSummary>;
    create(input: CreateSupplierDto, user: AuthenticatedUser): Promise<import("@acropora/types").SupplierSummary>;
    update(id: string, input: UpdateSupplierDto, user: AuthenticatedUser): Promise<import("@acropora/types").SupplierSummary>;
}
