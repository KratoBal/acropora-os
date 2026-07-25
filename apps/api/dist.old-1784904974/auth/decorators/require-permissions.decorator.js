import { SetMetadata } from "@nestjs/common";
export const REQUIRED_PERMISSIONS_KEY = "acropora:required-permissions";
export const RequirePermissions = (...permissions) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
//# sourceMappingURL=require-permissions.decorator.js.map