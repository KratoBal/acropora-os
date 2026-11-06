import { latogatoIp } from "@/lib/ip";
import { jatekApiKornyezetbol } from "@/lib/jatek-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/nyeremeny-kep/<kérdés azonosítója>: a heti nyeremény képe. A kép az OS api-tól jön (a lap szervere hívja, az api
 * címe és a titok nem kerül a böngészőbe); az api csak nyilvános kérdés képét adja ki (megnyílt, vagy a következő). Csak
 * kép megy tovább, rövid ideig gyorsítótárazva.
 */
export async function GET(
  keres: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    return new Response(null, { status: 404 });
  const valasz = await jatekApiKornyezetbol(process.env).kep(
    id,
    latogatoIp(keres.headers.get("x-forwarded-for")),
  );
  if (!valasz.ok)
    return new Response(null, { status: valasz.status === 404 ? 404 : 502 });
  return new Response(valasz.bytes, {
    headers: {
      "Content-Type": valasz.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
