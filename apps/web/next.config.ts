import type { NextConfig } from "next";

const apiUrl = process.env.API_URL?.replace(/\/$/, "");

if (!apiUrl) {
  throw new Error(
    "API_URL is required when building @acropora/web. Pass it as a Docker build argument or environment variable.",
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
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
