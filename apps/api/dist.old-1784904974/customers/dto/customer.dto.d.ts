export declare class CreateCustomerAddressDto {
    type: "BILLING" | "SHIPPING" | "OTHER";
    name?: string;
    country?: string;
    postalCode: string;
    city: string;
    line1: string;
    line2?: string;
    isDefault: boolean;
}
export declare class CreateCustomerDto {
    type: "PERSON" | "COMPANY";
    displayName: string;
    companyName?: string;
    taxNumber?: string;
    email?: string;
    phone?: string;
    marketingEmailConsent: boolean;
    marketingSmsConsent: boolean;
    addresses: CreateCustomerAddressDto[];
}
export declare class UpdateCustomerDto {
    displayName?: string;
    companyName?: string | null;
    taxNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    marketingEmailConsent?: boolean;
    marketingSmsConsent?: boolean;
    expectedUpdatedAt: string;
}
export declare class CustomerListQueryDto {
    page: number;
    pageSize: number;
    search?: string;
    status: "ACTIVE" | "INACTIVE" | "ALL";
    source?: "UNAS" | "MANUAL";
}
