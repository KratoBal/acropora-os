import { defineConfig } from "prisma/config";

process.env.DATABASE_URL ??=
  "postgresql://acropora:acropora@localhost:5432/acropora?schema=public&connect_timeout=2";

export default defineConfig({
  schema: "prisma/schema.prisma",
});
