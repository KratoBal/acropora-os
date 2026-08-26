import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class AiChatRequestDto {
  /**
   * The question. Bounded at both ends: the AI service refuses an empty
   * message and anything over four thousand characters, so refusing it here
   * saves a pointless round trip and gives a clearer error.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  /** Continues an existing conversation. Absent starts a new one. */
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
