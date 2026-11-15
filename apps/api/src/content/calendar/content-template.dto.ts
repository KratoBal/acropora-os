import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import {
  CONTENT_TEMPLATE_ANCHORS,
  CONTENT_TEMPLATE_EVENT_KINDS,
  CONTENT_TEMPLATE_LIMITS,
} from "@acropora/types";

import { CONTENT_CHANNELS } from "../dto/content.dto.js";

const L = CONTENT_TEMPLATE_LIMITS;

/** A new template row. A missing anchor counts from the start, a missing `active` is on. */
export class CreateContentTemplateRuleDto {
  @IsIn(CONTENT_TEMPLATE_EVENT_KINDS)
  eventKind!: (typeof CONTENT_TEMPLATE_EVENT_KINDS)[number];
  @IsString()
  @MinLength(L.label.min)
  @MaxLength(L.label.max)
  label!: string;
  @IsIn(CONTENT_CHANNELS) channel!: (typeof CONTENT_CHANNELS)[number];
  @IsOptional()
  @IsIn(CONTENT_TEMPLATE_ANCHORS)
  anchor?: (typeof CONTENT_TEMPLATE_ANCHORS)[number];
  @Type(() => Number)
  @IsInt()
  @Min(L.offsetDays.min)
  @Max(L.offsetDays.max)
  offsetDays!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Every field optional; the event kind stays (a row moved to another kind would be a different row). */
export class UpdateContentTemplateRuleDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(L.label.min)
  @MaxLength(L.label.max)
  label?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(CONTENT_CHANNELS)
  channel?: (typeof CONTENT_CHANNELS)[number];
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(CONTENT_TEMPLATE_ANCHORS)
  anchor?: (typeof CONTENT_TEMPLATE_ANCHORS)[number];
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(L.offsetDays.min)
  @Max(L.offsetDays.max)
  offsetDays?: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
