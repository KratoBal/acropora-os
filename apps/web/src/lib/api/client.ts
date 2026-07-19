export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("A szerver nem érhető el. Ellenőrizd a kapcsolatot.", 0);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError("A munkamenet lejárt. Jelentkezz be újra.", 401);
    }
    if (response.status === 403) {
      throw new ApiError("Nincs jogosultságod ehhez a művelethez.", 403);
    }
    if (response.status === 400) {
      throw new ApiError("A megadott szűrők nem érvényesek.", 400);
    }
    throw new ApiError("A kérés feldolgozása nem sikerült.", response.status);
  }

  return (await response.json()) as T;
}
