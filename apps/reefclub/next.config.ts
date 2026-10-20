import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

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
const apiUrl = (() => {
  const configured = process.env.REEFCLUB_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  try {
    const rootEnv = readFileSync(
      join(process.cwd(), "..", "..", ".env"),
      "utf8",
    );
    const value = rootEnv
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("REEFCLUB_API_URL="))
      ?.slice("REEFCLUB_API_URL=".length)
      .trim();
    if (value) return value.replace(/^(["'])(.*)\1$/, "$2").replace(/\/$/, "");
  } catch {
    // Docker and CI provide REEFCLUB_API_URL directly.
  }

  throw new Error(
    "REEFCLUB_API_URL is required when building @acropora/reefclub.",
  );
})();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@acropora/types", "@acropora/aquarium-calc"],
  async rewrites() {
    return [{ source: "/rc/v1/:path*", destination: `${apiUrl}/rc/v1/:path*` }];
  },
};

export default nextConfig;
