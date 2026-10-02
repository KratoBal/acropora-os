export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 135;
/** Dedicated streaming route bypasses the general rewrite's 50-second timeout. */
export async function POST(request: Request): Promise<Response> {
  try {
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    });
    for (const name of ["authorization", "cookie", "x-csrf-token"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(
      `${process.env.ACROPORA_API_PROXY_URL ?? process.env.API_URL}/assistant/ask`,
      {
        method: "POST",
        headers,
        body: await request.text(),
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(130_000)]),
      },
    );
    const responseHeaders = new Headers({
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/x-ndjson",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    });
    // Preserve ordinary USER sliding-session cookie refreshes from AuthGuard.
    for (const cookie of upstream.headers.getSetCookie?.() ?? [])
      responseHeaders.append("Set-Cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(
      JSON.stringify({
        type: "error",
        message: "Sutyerák most nem tud válaszolni. Próbáld meg később.",
      }) + "\n",
      {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
