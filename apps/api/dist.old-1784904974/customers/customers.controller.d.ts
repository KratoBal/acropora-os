import { type AuthenticatedUser } from "@acropora/types";
import { CustomersService } from "./customers.service.js";
import { CreateCustomerDto, CustomerListQueryDto, UpdateCustomerDto } from "./dto/customer.dto.js";
export declare class CustomersController {
    private readonly service;
    constructor(service: CustomersService);
    list(query: CustomerListQueryDto): Promise<import("@acropora/types").CustomerListResponse>;
    detail(id: string): Promise<import("@acropora/types").CustomerDetail>;
    create(input: CreateCustomerDto, user: AuthenticatedUser): Promise<import("@acropora/types").CustomerDetail>;
    update(id: string, input: UpdateCustomerDto, user: AuthenticatedUser): Promise<import("@acropora/types").CustomerDetail>;
}
