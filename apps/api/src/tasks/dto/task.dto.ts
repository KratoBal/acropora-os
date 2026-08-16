import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import type { TaskStatusFilter } from "@acropora/types";

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 4000;
export const TASK_LINK_URL_MAX_LENGTH = 500;

export class TaskListQueryDto {
  @IsIn(["OPEN", "DONE", "ALL"])
  @IsOptional()
  status: TaskStatusFilter = "OPEN";
}

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  @IsOptional()
  description?: string;

  // Deliberately validated as a plain bounded string here and checked for an
  // http/https scheme in TasksService instead of with @IsUrl: the value is
  // rendered as an anchor href, so the scheme allowlist is a security
  // control and belongs where it can be unit-tested directly.
  @IsString()
  @MaxLength(TASK_LINK_URL_MAX_LENGTH)
  @IsOptional()
  linkUrl?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;
}
