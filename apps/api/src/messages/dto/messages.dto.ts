import { Type } from "class-transformer";
import {
  CONVERSATION_CONTEXT_TYPES,
  CONVERSATION_MAX_MEMBERS,
  CONVERSATION_NOTIFY_MODES,
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_PAGE_MAX,
  MESSAGE_SEARCH_MAX_LENGTH,
  MESSAGE_SEARCH_MIN_LENGTH,
  MESSAGE_TEXT_MAX_LENGTH,
  type ConversationContextType,
  type ConversationNotifyMode,
} from "@acropora/types";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
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
  /** Csatolmánnyal szöveg nélkül is mehet (a 2. fázis óta). */
  @IsOptional() @IsString() @MaxLength(MESSAGE_TEXT_MAX_LENGTH) text?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MESSAGE_ATTACHMENTS_MAX)
  @IsString({ each: true })
  attachmentIds?: string[];
  @IsOptional() @IsString() @MinLength(1) replyToMessageId?: string;
  /** A kliens saját azonosítója: az újraküldés ezzel nem duplikál. */
  @IsString() @MinLength(8) @MaxLength(64) clientMessageId!: string;
}

export class MarkReadDto {
  @IsString() @MinLength(1) messageId!: string;
}

export class MessagePageQueryDto {
  @IsOptional() @IsString() @MaxLength(200) before?: string;
  /** 3. fázis, „Ugrás” után: az újabb oldal kurzora. */
  @IsOptional() @IsString() @MaxLength(200) after?: string;
  /** 3. fázis, „Ugrás”: az üzenet azonosítója, ami köré az oldal nyílik. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) around?: string;
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

export class EditMessageDto {
  @IsString() @MaxLength(MESSAGE_TEXT_MAX_LENGTH) text!: string;
}

export class ReactionDto {
  @IsString() @MinLength(1) @MaxLength(16) reaction!: string;
}

export class AttachmentQueryDto {
  @IsOptional() @IsString() @MaxLength(20) variant?: string;
}

/** Keresés a megnyitott beszélgetésben (3. fázis, prompt 13. pont). */
export class MessageSearchQueryDto {
  @IsString()
  @MinLength(MESSAGE_SEARCH_MIN_LENGTH)
  @MaxLength(MESSAGE_SEARCH_MAX_LENGTH)
  q!: string;
}

/** A megosztott média vagy fájlok egy oldala (3. fázis, prompt 15. pont). */
export class SharedAttachmentQueryDto {
  @IsIn(["IMAGE", "FILE"]) kind!: "IMAGE" | "FILE";
  @IsOptional() @IsString() @MaxLength(200) before?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX)
  limit?: number;
}

/** Az értesítési beállítás (3. fázis, prompt 17. pont). */
export class NotificationSettingDto {
  @IsIn([...CONVERSATION_NOTIFY_MODES]) mode!: ConversationNotifyMode;
}

/** Továbbítás egy másik beszélgetésbe (3. fázis, prompt 9. pont). */
export class ForwardMessageDto {
  @IsString() @MinLength(1) @MaxLength(64) conversationId!: string;
  /** Mint a küldésnél: egy újraküldés ezzel nem duplikál. */
  @IsString() @MinLength(8) @MaxLength(64) clientMessageId!: string;
}

/** Egy meglévő csoport kötése munkalaphoz vagy hibajegyhez (4. fázis). */
export class LinkContextDto {
  @IsIn([...CONVERSATION_CONTEXT_TYPES]) type!: ConversationContextType;
  @IsString() @MinLength(1) @MaxLength(64) id!: string;
}

/** Tagok felvétele egy csoportba (4. fázis). */
export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONVERSATION_MAX_MEMBERS)
  @IsString({ each: true })
  userIds!: string[];
}

/** A partner nézete a portálon (084e2c24): csak a régebbi lap kurzora és a méret. */
export class PartnerConversationQueryDto {
  @IsOptional() @IsString() @MaxLength(200) before?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX)
  limit?: number;
}

/** A partner üzenete (084e2c24): csak szöveg; az újraküldés nem duplikál. */
export class PartnerMessageDto {
  @IsString() @MinLength(1) @MaxLength(MESSAGE_TEXT_MAX_LENGTH) text!: string;
  @IsString() @MinLength(8) @MaxLength(64) clientMessageId!: string;
}
