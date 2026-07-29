import { apiRequest } from "@/lib/api/client";

type ApiHealthResponse = {
  application: {
    status: string;
    version: string;
  };
  database?: { status?: string };
  redis?: { status?: string };
};

type HealthResponse = {
  status: string;
  version: string;
  database?: { status?: string };
  redis?: { status?: string };
};

export async function getApiHealth(): Promise<HealthResponse> {
  const health = await apiRequest<ApiHealthResponse>("/health");

  return {
    status: health.application.status,
    version: health.application.version,
    database: health.database,
    redis: health.redis,
  };
}
