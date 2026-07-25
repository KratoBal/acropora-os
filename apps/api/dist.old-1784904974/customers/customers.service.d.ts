import { CustomersRepository } from "./customers.repository.js";
import type { CreateCustomerDto, CustomerListQueryDto, UpdateCustomerDto } from "./dto/customer.dto.js";
export declare class CustomersService {
    private readonly repository;
    constructor(repository: CustomersRepository);
    list(query: CustomerListQueryDto): Promise<import("@acropora/types").CustomerListResponse>;
    detail(id: string): Promise<import("@acropora/types").CustomerDetail>;
    create(input: CreateCustomerDto, actorId: string): Promise<import("@acropora/types").CustomerDetail>;
    update(id: string, input: UpdateCustomerDto, actorId: string): Promise<import("@acropora/types").CustomerDetail>;
    private map;
}
