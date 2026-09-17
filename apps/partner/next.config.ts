import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const apiUrl = (() => {
  const configured = process.env.API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  try {
    const rootEnv = readFileSync(
      join(process.cwd(), "..", "..", ".env"),
      "utf8",
    );
    const value = rootEnv
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("API_URL="))
      ?.slice("API_URL=".length)
      .trim();
    if (value) return value.replace(/^(["'])(.*)\1$/, "$2").replace(/\/$/, "");
  } catch {
    // Docker and CI provide API_URL directly.
  }

  throw new Error("API_URL is required when building @acropora/partner.");
})();

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@acropora/types"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
