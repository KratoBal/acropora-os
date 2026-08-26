import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  AI_RATING_AXES,
  AI_RATINGS_BY_AXIS,
  type AiAnswerRating,
  type AiRatingAxis,
} from "@acropora/types";

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
   * Which axis this judgement is about, required with no default.
   *
   * Defaulting to `accuracy` would be the convenient choice and the wrong
   * one: a caller that forgot the field would file a judgement about wording
   * as a judgement about facts, and afterwards nothing could tell them apart.
   */
  @IsIn(AI_RATING_AXES as unknown as string[])
  axis!: AiRatingAxis;

  /**
   * Validated against the shared lists rather than copies of them.
   *
   * The same values are the buttons on the screen and a CHECK constraint in
   * the AI service's database. A value added here alone would be accepted and
   * then rejected one hop later, by a constraint violation that says nothing
   * useful to the person who pressed the button.
   *
   * Whether it is legal ON THIS AXIS is checked in the controller, because a
   * class-validator rule cannot see a sibling field. That check is not
   * optional politeness: `natural` is a real rating and a valid one, just not
   * about facts, and a flat list of all eight would let the two vocabularies
   * merge in the data even though they never merged in the code.
   */
  @IsIn(Object.values(AI_RATINGS_BY_AXIS).flat() as unknown as string[])
  rating!: AiAnswerRating;
}
