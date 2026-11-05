import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
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
