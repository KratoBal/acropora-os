export type LocalOrderStatus = "DRAFT" | "PENDING" | "CONFIRMED" | "PICKING" | "PACKED" | "SHIPPED" | "COMPLETED" | "CANCELLED" | "ON_HOLD";
export declare function mapUnasOrderStatus(statusType: string | null): LocalOrderStatus;
