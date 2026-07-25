import { Repository } from "@acropora/database";
import type { CustomerDetail, CustomerListResponse } from "@acropora/types";
import type { CreateCustomerDto, CustomerListQueryDto, UpdateCustomerDto } from "./dto/customer.dto.js";
export declare class CustomersRepository extends Repository {
    constructor();
    list(query: CustomerListQueryDto): Promise<CustomerListResponse>;
    private loadUnasCustomerIds;
    detail(id: string): Promise<CustomerDetail | null>;
    create(input: CreateCustomerDto, actorId: string): Promise<CustomerDetail>;
    update(id: string, input: UpdateCustomerDto, actorId: string): Promise<CustomerDetail>;
    private loadExternalReferences;
    private toSummary;
    private toDetail;
    private event;
}
