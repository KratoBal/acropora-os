export const seedUsers = [
  {
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER" as const,
  },
  {
    email: "admin@acropora.local",
    displayName: "Acropora Admin",
    role: "ADMIN" as const,
  },
  {
    email: "warehouse@acropora.local",
    displayName: "Raktári Felhasználó",
    role: "WAREHOUSE" as const,
  },
  {
    email: "service@acropora.local",
    displayName: "Szerviz Felhasználó",
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
