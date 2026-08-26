import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { AI_ANSWER_RATINGS, type AiAnswerRating } from "@acropora/types";

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

export class AiChatRatingDto {
  /**
   * Validated against the shared list rather than a copy of it.
   *
   * The same four values are the buttons on the screen and a CHECK constraint
   * in the AI service's database. A fifth added here alone would be accepted
   * and then rejected one hop later, by a constraint violation that says
   * nothing useful to the person who pressed the button.
   */
  @IsIn(AI_ANSWER_RATINGS as unknown as string[])
  rating!: AiAnswerRating;
}
