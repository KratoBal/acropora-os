import {
  WEBSHOP_ORDER_STATUSES,
  type WebshopOrderStatus,
} from "@acropora/types";
import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class WebshopOrderStatusChangeDto {
  @IsIn([...WEBSHOP_ORDER_STATUSES])
  status!: WebshopOrderStatus;

  /** A „Vevő értesítése” jelölő; ha nincs, a webshop alapja (küld). */
  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;

  /**
   * A KISZÁLLÍTÁSI KAPU FELÜLBÍRÁLÁSÁNAK INDOKA (kártya 33a0d3c7). Csak akkor számít, ha a kapu tart (számla vagy csomag hiányzik), és csak
   * a `orders.shipping-override` joggal; a hossz-határokat a szabály (`shippingGateDecision`) őrzi, hogy egy üres indok 400 legyen, ne csendes
   * elutasítás.
   */
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
