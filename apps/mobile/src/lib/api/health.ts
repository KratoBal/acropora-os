import { apiRequest } from "@/lib/api/client";

type HealthResponse = {
  status: string;
  database?: { status?: string };
  redis?: { status?: string };
};

export function getApiHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/health");
}
