export declare class CreateSupplierDto {
    name: string;
    taxNumber?: string;
    country?: string;
    email?: string;
    phone?: string;
    iban?: string;
    swiftCode?: string;
    bankAccountNumber?: string;
    contactPersonName?: string;
    contactPersonPhone?: string;
    contactPersonEmail?: string;
    postalCode?: string;
    city?: string;
    addressLine1?: string;
    addressLine2?: string;
}
export declare class UpdateSupplierDto {
    name?: string;
    taxNumber?: string | null;
    country?: string;
    email?: string | null;
    phone?: string | null;
    iban?: string | null;
    swiftCode?: string | null;
    bankAccountNumber?: string | null;
    contactPersonName?: string | null;
    contactPersonPhone?: string | null;
    contactPersonEmail?: string | null;
    postalCode?: string | null;
    city?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    expectedUpdatedAt: string;
}
export declare class SupplierListQueryDto {
    page: number;
    pageSize: number;
    search?: string;
    status: "ACTIVE" | "INACTIVE" | "ALL";
}
