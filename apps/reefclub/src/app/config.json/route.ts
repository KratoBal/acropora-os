import { readPublicConfig } from "@/lib/public-config";

// Read per request: the values are runtime settings of the container.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(readPublicConfig(process.env), {
    headers: { "cache-control": "no-store" },
  });
}
