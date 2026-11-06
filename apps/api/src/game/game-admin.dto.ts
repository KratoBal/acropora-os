import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class GameOptionDto {
  @IsString()
  @MaxLength(20)
  id!: string;

  @IsString()
  @MaxLength(200)
  label!: string;
}

/** A weekly question, as the admin form sends it (create and edit alike); the service checks the rules. */
export class GameQuestionDto {
  @IsString()
  @MaxLength(10)
  week!: string;

  @IsIn(["TEXT", "CHOICE"])
  type!: string;

  @IsString()
  @MaxLength(1000)
  prompt!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GameOptionDto)
  options!: GameOptionDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  acceptedAnswers!: string[];

  @IsString()
  opensAt!: string;

  @IsString()
  closesAt!: string;

  /** The week's prize (all optional; `null` or an empty text clears one, an absent key leaves it as it is). */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(120)
  prizeName?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  prizeDescription?: string | null;

  /** an id from the mail image store (`POST /game/prize-images` returns it) */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  prizeImageId?: string | null;
}

/** A person's decision on an answer: true, false, or null (back to the automatic one). */
export class GameDecisionDto {
  @IsOptional()
  @IsBoolean()
  correct!: boolean | null;
}

export class GameDrawDto {
  @IsIn(["WEEKLY", "CHRISTMAS"])
  kind!: "WEEKLY" | "CHRISTMAS";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  questionId?: string;
}

export class GameTestMailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
