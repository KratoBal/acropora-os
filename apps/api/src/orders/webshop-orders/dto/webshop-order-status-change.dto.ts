import {
  WEBSHOP_ORDER_STATUSES,
  type WebshopOrderStatus,
} from "@acropora/types";
import { IsIn } from "class-validator";

export class WebshopOrderStatusChangeDto {
  @IsIn([...WEBSHOP_ORDER_STATUSES])
  status!: WebshopOrderStatus;
}
