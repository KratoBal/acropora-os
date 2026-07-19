import { PrismaClient } from "@prisma/client";

import {
  seedCategories,
  seedManufacturers,
  seedUsers,
} from "../src/seed-data.js";

process.env.DATABASE_URL ??=
  "postgresql://acropora:acropora@localhost:5432/acropora?schema=public&connect_timeout=2";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "A development seed production környezetben nem futtatható.",
    );
  }

  const prisma = new PrismaClient();

  try {
    await prisma.$transaction([
      ...seedUsers.map((user) =>
        prisma.user.upsert({
          where: { email: user.email },
          update: { ...user, isActive: true },
          create: user,
        }),
      ),
      ...seedCategories.map((category) =>
        prisma.category.upsert({
          where: { slug: category.slug },
          update: category,
          create: category,
        }),
      ),
      ...seedManufacturers.map((manufacturer) =>
        prisma.manufacturer.upsert({
          where: { slug: manufacturer.slug },
          update: manufacturer,
          create: manufacturer,
        }),
      ),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
