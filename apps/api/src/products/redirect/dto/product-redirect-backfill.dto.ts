import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

/**
 * A TERMÉK-ÁTIRÁNYÍTÁS (backfill) KÉRÉSE. Alapból SZÁRAZFUTÁS; íráshoz az utolsó szárazfutás `planHash`-e kell (ugyanaz a rend, mint a
 * kategória-betöltőnél). Az `inspect` a régi címek listája, amelyekről a jelentés külön megmondja, MIÉRT van vagy nincs szabályuk (melyik
 * termékhez tartozik a UNAS-címük, van-e webshop-slugja, áll-e már szabály rajta): a kimaradt címek okát egy szárazfutásból lehet olvasni.
 * Az `inspect` csak a jelentést bővíti, a tervet és a `planHash`-t nem.
 */
export class ProductRedirectBackfillDto {
  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  planHash?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  inspect?: string[];
}
