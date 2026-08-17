import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_LINK_URL_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "./task.dto.js";

export const TASK_REFERENCE_MAX_LENGTH = 200;

export class IngestTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(TASK_LINK_URL_MAX_LENGTH)
  @IsOptional()
  linkUrl?: string;

  @IsEmail()
  assigneeEmail!: string;

  // Required on purpose. A machine caller that cannot name the item it is
  // reporting cannot be replayed safely, and an agent that restarts mid-run
  // would otherwise duplicate every task it had already filed.
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_REFERENCE_MAX_LENGTH)
  reference!: string;
}
