import {
  WEBSHOP_PARCEL_SIZES,
  type WebshopOrderParcelCreate,
  type WebshopParcelSize,
} from "@acropora/types";
import { IsIn, IsOptional } from "class-validator";

export class WebshopOrderParcelCreateDto implements WebshopOrderParcelCreate {
  /** Csak Foxpostnál megy a szállítónak; GLS-nél a szerver eldobja. */
  @IsOptional()
  @IsIn([...WEBSHOP_PARCEL_SIZES])
  size?: WebshopParcelSize;
}
