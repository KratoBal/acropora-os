import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

import { resolveReefClubApiUrl } from "./src/lib/api-url";

/**
 * THE REEFCLUB API ADDRESS, BAKED IN AT BUILD TIME (Next stores rewrites in the
 * routes manifest), the way apps/partner does with API_URL. It must be the
 * ReefClub container (`REEFCLUB_PROCESS=true`, docs/REEFCLUB-DEPLOYMENT.md),
 * never the internal API: the browser only ever calls `/rc/v1/*` on THIS host,
 * and this app forwards exactly that prefix.
 *
 * WHY A REWRITE AND NOT A SECOND HOST: the ReefClub cookies carry the `__Host-`
 * prefix in production, so the CSRF double submit works only when the page and
 * the `/rc/v1` answers come from the same host
 * (apps/api/src/reefclub/reefclub-cookies.ts, barracuda #1717 point C).
 */
const apiUrl = resolveReefClubApiUrl(process.env, () => {
  try {
    return readFileSync(join(process.cwd(), "..", "..", ".env"), "utf8");
  } catch {
    // Docker and CI provide REEFCLUB_API_URL directly.
    return null;
  }
});

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@acropora/types", "@acropora/aquarium-calc"],
  async rewrites() {
    return [{ source: "/rc/v1/:path*", destination: `${apiUrl}/rc/v1/:path*` }];
  },
};

export default nextConfig;
