import {
  WEBSHOP_ORDER_STATUSES,
  type WebshopOrderStatus,
} from "@acropora/types";
import { IsBoolean, IsIn, IsOptional } from "class-validator";

export class WebshopOrderStatusChangeDto {
  @IsIn([...WEBSHOP_ORDER_STATUSES])
  status!: WebshopOrderStatus;

  /** A „Vevő értesítése” jelölő; ha nincs, a webshop alapja (küld). */
  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;
}
