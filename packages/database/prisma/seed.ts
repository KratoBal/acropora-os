import { PrismaClient, UserRole } from "../src/generated/client";

process.env.DATABASE_URL ??=
  "postgresql://acropora:acropora_dev@localhost:5432/acropora_os?schema=public";

export const developmentUsers = [
  {
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: UserRole.OWNER,
  },
  {
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    role: UserRole.ADMIN,
  },
  {
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    role: UserRole.WAREHOUSE,
  },
  {
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
    role: UserRole.SERVICE,
  },
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "A development seed production környezetben nem futtatható.",
    );
  }

  const prisma = new PrismaClient();

  try {
    for (const user of developmentUsers) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          displayName: user.displayName,
          role: user.role,
          isActive: true,
        },
        create: user,
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
