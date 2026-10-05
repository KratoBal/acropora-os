import { Type } from "class-transformer";
import {
  CONVERSATION_MAX_MEMBERS,
  MESSAGE_PAGE_MAX,
  MESSAGE_TEXT_MAX_LENGTH,
} from "@acropora/types";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Egy tag: DIRECT (a meglévőt kapja vissza, ha van), több tag: GROUP. A név és
 * a leírás csak csoportnál számít. Közönség-mező NINCS: minden beszélgetés
 * `INTERNAL`, és a globális `forbidNonWhitelisted` egy beküldött `audience`
 * mezőt elutasít.
 */
export class CreateConversationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONVERSATION_MAX_MEMBERS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  memberIds!: string[];

  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class SendMessageDto {
  @IsString() @MaxLength(MESSAGE_TEXT_MAX_LENGTH) text!: string;
  /** A kliens saját azonosítója: az újraküldés ezzel nem duplikál. */
  @IsString() @MinLength(8) @MaxLength(64) clientMessageId!: string;
}

export class MarkReadDto {
  @IsString() @MinLength(1) messageId!: string;
}

export class MessagePageQueryDto {
  @IsOptional() @IsString() @MaxLength(200) before?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX)
  limit?: number;
}

export class MessagePeopleQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
