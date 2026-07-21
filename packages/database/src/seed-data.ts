export const seedUsers = [
  {
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    firstName: "Acropora",
    lastName: "Tulajdonos",
    role: "OWNER" as const,
  },
  {
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    firstName: "Acropora",
    lastName: "Admin",
    role: "ADMIN" as const,
  },
  {
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    firstName: "Raktári",
    lastName: "Felhasználó",
    role: "WAREHOUSE" as const,
  },
  {
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
    firstName: "Szerviz",
    lastName: "Felhasználó",
    role: "SERVICE" as const,
  },
] as const;

export const seedCategories = [
  { name: "Akváriumok", slug: "akvariumok" },
  { name: "Szűréstechnika", slug: "surestechnika" },
  { name: "Világítás", slug: "vilagitas" },
  { name: "Vízkezelés", slug: "vizkezeles" },
  { name: "Eleség", slug: "eleseg" },
] as const;

export const seedBrands = [
  { name: "Red Sea", slug: "red-sea" },
  { name: "Aqua Medic", slug: "aqua-medic" },
  { name: "Tropic Marin", slug: "tropic-marin" },
  { name: "Eheim", slug: "eheim" },
  { name: "JBL", slug: "jbl" },
].map((brand) => ({
  ...brand,
  normalizedName: brand.name.toLowerCase(),
}));
