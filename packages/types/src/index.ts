export type ServiceStatus = "ok" | "degraded";

export interface HealthResponse {
  service: "acropora-api";
  status: ServiceStatus;
  timestamp: string;
}

export interface NavigationItem {
  label: string;
  description: string;
}

export {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";
export type {
  AuthenticatedUser,
  Permission,
  Session,
  UserRole,
} from "./auth.js";
