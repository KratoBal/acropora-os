import { MESSAGE_TEXT_MAX_LENGTH } from "@acropora/types";
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * ACROBOT VÁLASZA EGY ÁTADOTT KÉRDÉSRE. Beszélgetésből jött kérdésnél a
 * `conversationId`, a widgetből jöttnél a `userId` (ott nincs beszélgetés):
 * PONTOSAN az egyik, ezt a szolgáltatás ellenőrzi.
 */
export class SutyerakHandoffReplyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  userId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  @Matches(/\S/)
  text!: string;
}
