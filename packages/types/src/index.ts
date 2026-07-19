export type HealthStatus = "ok" | "unavailable";

export interface DependencyHealth {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  application: DependencyHealth & { version: string };
  database: DependencyHealth;
  redis: DependencyHealth;
  uptime: number;
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
