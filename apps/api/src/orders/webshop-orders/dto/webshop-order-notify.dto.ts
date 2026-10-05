import { IsBoolean, IsOptional } from "class-validator";

/** A „Vevő értesítése” jelölő egy webshop-műveletnél; ha nincs, a webshop alapja (küld). */
export class WebshopOrderNotifyDto {
  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;
}
