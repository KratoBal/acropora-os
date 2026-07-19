import { defineConfig } from "prisma/config";

process.env.DATABASE_URL ??=
  "postgresql://acropora:acropora_dev@localhost:5432/acropora_os?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
});
