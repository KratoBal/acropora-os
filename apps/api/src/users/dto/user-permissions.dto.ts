import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, ValidateNested } from "class-validator";
import {
  ALL_PERMISSION_VALUES,
  PERMISSION_OVERRIDE_EFFECTS,
  type Permission,
  type PermissionOverrideEffect,
  type UpdateUserPermissionOverridesInput,
} from "@acropora/types";

export class PermissionOverrideDto {
  @IsIn(ALL_PERMISSION_VALUES)
  permission!: Permission;

  @IsIn(PERMISSION_OVERRIDE_EFFECTS)
  effect!: PermissionOverrideEffect;
}

/** `PUT /users/:id/permissions`: a felhasználó eltéréseinek TELJES listája. */
export class UpdateUserPermissionOverridesDto implements UpdateUserPermissionOverridesInput {
  @IsArray()
  @ArrayMaxSize(ALL_PERMISSION_VALUES.length)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  overrides!: PermissionOverrideDto[];
}
