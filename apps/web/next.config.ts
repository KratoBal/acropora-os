import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@acropora/ui", "@acropora/types"],

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://api.acropora.hu/:path*",
      },
    ];
  },
};

export default nextConfig;