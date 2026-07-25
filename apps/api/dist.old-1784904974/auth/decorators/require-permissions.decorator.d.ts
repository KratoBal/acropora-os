import type { Permission } from "@acropora/types";
export declare const REQUIRED_PERMISSIONS_KEY = "acropora:required-permissions";
export declare const RequirePermissions: (...permissions: Permission[]) => import("@nestjs/common").CustomDecorator<string>;
