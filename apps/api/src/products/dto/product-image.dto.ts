import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * EGY KÉP ALT-SZÖVEGE (T4.1-D3, 4. szelet). Üres vagy null: nincs kézi alt, és a
 * kirakat a termék nevét teszi a helyére (polip D3: gépi alapérték a név, kézi
 * felülírás). A hossz a Medusa-metaadatba menő szöveg felső határa.
 */
export class SetProductImageAltDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText!: string | null;
}

/** A termék képeinek sorrendje: a termék MINDEN képének azonosítója, pontosan egyszer. */
export class SetProductImageOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  imageIds!: string[];
}
