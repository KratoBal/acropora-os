import type {
  AssetListResponse,
  AuthenticatedUser,
  ServiceJobDetail,
  ServiceJobListResponse,
  WorksheetDepartmentListResponse,
  WorksheetListResponse,
} from "@acropora/types";

const apiPrefix = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function csrfHeader(method: string): Record<string, string> {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return {};
  const value = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "acropora_csrf")
    ?.slice(1)
    .join("=");
  return value ? { "X-CSRF-Token": decodeURIComponent(value) } : {};
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${apiPrefix}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(typeof init?.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...csrfHeader(method),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "A szerver nem érhető el. Kérjük, próbálja meg később.",
      0,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(" ")
      : body?.message;
    throw new ApiError(
      message ??
        (response.status === 403
          ? "Nincs hozzáférése ehhez az adathoz."
          : "A kérés feldolgozása nem sikerült."),
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export const partnerApi = {
  me: () => request<AuthenticatedUser>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: AuthenticatedUser }>("/auth/login/password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  tickets: (scope: "all" | "open" | "closed") =>
    request<ServiceJobListResponse>(
      `/service/jobs?${new URLSearchParams({ scope })}`,
    ),
  ticket: (id: string) =>
    request<ServiceJobDetail>(`/service/jobs/${encodeURIComponent(id)}`),
  createTicket: (input: {
    title: string;
    description?: string;
    departmentId?: string;
    assetIds?: string[];
  }) =>
    request<{ id: string; jobNumber: string }>("/service/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  departments: (customerId: string) =>
    request<WorksheetDepartmentListResponse>(
      `/service/worksheets/customers/${encodeURIComponent(customerId)}/departments`,
    ),
  assets: (customerId: string, departmentId?: string) => {
    const query = new URLSearchParams({
      ownerType: "CUSTOMER",
      ownerId: customerId,
      status: "ALL",
      pageSize: "100",
    });
    if (departmentId) query.set("departmentId", departmentId);
    return request<AssetListResponse>(`/service/assets?${query}`);
  },
  worksheets: () =>
    request<WorksheetListResponse>("/service/worksheets?page=1&pageSize=100"),
};
