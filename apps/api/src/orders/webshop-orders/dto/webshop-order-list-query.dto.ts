import {
  WEBSHOP_ORDER_STAGES,
  WEBSHOP_ORDER_STATUSES,
  type WebshopOrderListQuery,
  type WebshopOrderPaymentState,
  type WebshopOrderSortField,
  type WebshopOrderStage,
  type WebshopOrderStatus,
} from "@acropora/types";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_STATES: WebshopOrderPaymentState[] = [
  "AWAITING",
  "AUTHORIZED",
  "CAPTURED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "CANCELED",
  "FAILED",
];
const SORTS: WebshopOrderSortField[] = [
  "displayId",
  "createdAt",
  "customer",
  "total",
  "status",
];

export class WebshopOrderListQueryDto implements WebshopOrderListQuery {
  @IsOptional() @IsIn(["open", "all"]) view?: "open" | "all";
  @IsOptional() @IsIn([...WEBSHOP_ORDER_STAGES]) stage?: WebshopOrderStage;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Matches(DAY) from?: string;
  @IsOptional() @Matches(DAY) to?: string;
  @IsOptional() @IsIn([...WEBSHOP_ORDER_STATUSES]) status?: WebshopOrderStatus;
  @IsOptional() @IsString() @MaxLength(100) shippingMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) paymentMethod?: string;
  @IsOptional() @IsIn(PAYMENT_STATES) paymentState?: WebshopOrderPaymentState;
  @IsOptional() @IsIn(["issued", "missing"]) invoice?: "issued" | "missing";
  @IsOptional()
  @IsIn(["registered", "guest"])
  customerType?: "registered" | "guest";
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  newCustomer?: boolean;
  @IsOptional() @IsIn(SORTS) sort?: WebshopOrderSortField;
  @IsOptional() @IsIn(["asc", "desc"]) direction?: "asc" | "desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
