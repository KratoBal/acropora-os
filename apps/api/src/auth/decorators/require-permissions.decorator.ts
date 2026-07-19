import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@acropora/types";

export const REQUIRED_PERMISSIONS_KEY = "acropora:required-permissions";

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
