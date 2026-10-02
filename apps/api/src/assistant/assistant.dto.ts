import {
  IsDefined,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
export class AssistantContextDto {
  @IsString() @MaxLength(300) @Matches(/^\/(?!\/)[^?#\s]*$/) page!: string;
  @IsOptional() @IsString() @MaxLength(300) entity?: string;
}
export class AssistantAskDto {
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) question!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) threadId?: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context!: AssistantContextDto;
}
