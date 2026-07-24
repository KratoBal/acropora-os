import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained runtime output for Docker: only the traced dependency
  // subset needed at runtime is emitted to .next/standalone, avoiding the
  // need to ship the full node_modules tree in the production image.
  output: "standalone",
  transpilePackages: ["@acropora/ui", "@acropora/types"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
