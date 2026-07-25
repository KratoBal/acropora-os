declare const POS_PAYMENT_METHODS: readonly ["CASH", "CARD", "TRANSFER"];
export declare class CreatePosSaleLineDto {
    variantId: string;
    quantity: number;
    unitGross: number;
}
export declare class CreatePosSaleDto {
    paymentMethod: (typeof POS_PAYMENT_METHODS)[number];
    customerId?: string;
    lines: CreatePosSaleLineDto[];
}
export {};
