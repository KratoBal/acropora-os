import type { NextConfig } from "next";

import { proxyTimeoutMs } from "./src/lib/proxy-timeout";

const apiUrl = process.env.API_URL?.replace(/\/$/, "");

if (!apiUrl) {
  throw new Error(
    "API_URL is required when building @acropora/web. Pass it as a Docker build argument or environment variable.",
  );
}

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
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
