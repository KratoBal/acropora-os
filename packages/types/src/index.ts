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
