import type { Prisma } from "@acropora/database";

import { startOfBudapestDay } from "../dashboard/budapest-day.js";

/**
 * AZ ÁRAJÁNLAT LÉTREHOZÁSÁNAK NAPJA SZERINTI SZŰRŐ (Luca kérése, acrobot 61261, kártya 7e5d3658): `createdFrom` és `createdTo`,
 * `YYYY-MM-DD` budapesti naptári napok, MINDKÉT VÉG BENNE VAN. A számlázás lista kelt-szűrőjének mintája (`ownIssueRange`):
 * a határ a `from` napjának budapesti kezdete és a `to` UTÁNI nap budapesti kezdete (kizáró), így a nyári és téli időszámítás
 * váltásának napján sem csúszik el egy óra, és egy este 23:30-kor készült ajánlat a saját napján jön. Egyik határ nélkül nyitott
 * a másik oldal; egyik sem: nincs szűrő (`null`).
 */
export function createdAtRange(filter: {
  createdFrom?: string;
  createdTo?: string;
}): Prisma.DateTimeFilter | null {
  if (!filter.createdFrom && !filter.createdTo) return null;
  const range: Prisma.DateTimeFilter = {};
  if (filter.createdFrom)
    range.gte = startOfBudapestDay(new Date(`${filter.createdFrom}T12:00:00Z`));
  if (filter.createdTo)
    range.lt = startOfBudapestDay(new Date(`${filter.createdTo}T12:00:00Z`), 1);
  return range;
}
