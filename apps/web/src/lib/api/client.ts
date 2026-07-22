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
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("A szerver nem érhető el. Ellenőrizd a kapcsolatot.", 0);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError("A munkamenet lejárt. Jelentkezz be újra.", 401);
    }
    if (response.status === 403) {
      throw new ApiError("Nincs jogosultságod ehhez a művelethez.", 403);
    }
    let serverMessage: string | undefined;
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      serverMessage = Array.isArray(payload.message)
        ? payload.message.join(" ")
        : payload.message;
    } catch {
      serverMessage = undefined;
    }
    const fallback: Record<number, string> = {
      400: "A megadott adatok nem érvényesek.",
      404: "A kért import batch nem található.",
      409: "Az adat időközben megváltozott. Frissítsd a listát.",
      422: "A művelet üzleti feltételei nem teljesülnek.",
    };
    throw new ApiError(
      serverMessage ??
        fallback[response.status] ??
        "A kérés feldolgozása nem sikerült.",
      response.status,
    );
  }

  return (await response.json()) as T;
}
