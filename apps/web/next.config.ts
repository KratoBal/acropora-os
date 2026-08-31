import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";

import { API_PREFIX } from "./src/lib/api/api-prefix";
import { resolveApiUrl } from "./src/lib/api/resolve-api-url";
import { proxyTimeoutMs } from "./src/lib/proxy-timeout";

/**
 * `next build` runs with this package as its working directory, so the
 * repository root is two levels up. The read is best-effort on purpose: no
 * `.env` is the normal state in Docker and in CI, where the variable itself is
 * set, and a missing file must not be the thing that fails the build.
 */
const readRootEnvFile = () => {
  try {
    return readFileSync(join(process.cwd(), "..", "..", ".env"), "utf8");
  } catch {
    return undefined;
  }
};

const apiUrl = resolveApiUrl({ env: process.env, readRootEnvFile });

const nextConfig: NextConfig = {
  output: "standalone",

  /**
   * The rewrite proxy's own timeout, raised above the limits inside the chain.
   *
   * Left at Next's default of 30 000 ms it is the shortest limit in front of
   * every `/api/*` call, and the one that fires first - with a bare 500 that
   * says nothing about what happened. See src/lib/proxy-timeout.ts for the
   * ladder and for why this is a BUILD-time value.
   */
  experimental: {
    proxyTimeout: proxyTimeoutMs(),
  },
  transpilePackages: ["@acropora/ui", "@acropora/types"],

  async rewrites() {
    return [
      {
        // A BONGESZO ELOTAGJA EGY HELYEN. Ez a szabaly az, ami a szonak
        // jelentest ad: enelkul a kliensek /api elotagja semmire nem mutatna.
        // Ezert ugyanabbol a konstansbol epul, mint a hivo oldal -- egy
        // atnevezes igy nem tud felig sikerulni.
        source: `${API_PREFIX}/:path*`,
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
