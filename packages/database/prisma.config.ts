import { defineConfig } from "prisma/config";

// Local development only: if DATABASE_URL is missing, fall back to the
// docker-compose default so `pnpm prisma:*` works out of the box after
// `docker compose up -d`. In every other environment a missing
// DATABASE_URL is a misconfiguration and must fail loudly rather than
// silently pointing at localhost.
if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. Refusing to fall back to a local development " +
        "connection string in production.",
    );
  }
  process.env.DATABASE_URL =
    "postgresql://acropora:acropora@localhost:5432/acropora?schema=public&connect_timeout=2";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
});
