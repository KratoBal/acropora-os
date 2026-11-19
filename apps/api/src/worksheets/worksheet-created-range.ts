import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@acropora/database";

import { startOfBudapestDay } from "../dashboard/budapest-day.js";

/**
 * A MUNKALAP-LISTA "MEGNYITVA" TÓL-IG SZŰRŐJE (kártya a785e580, Luca 2026-11-19). A megnyitás (létrehozás) pillanata
 * időbélyeg, a nap a BUDAPESTI naptári nap: a határ a `from` napjának budapesti kezdete és a `to` UTÁNI nap budapesti
 * kezdete (kizáró), tehát mindkét határnap benne van, és az éjfél utáni 00:30 (UTC-ben még előző nap) a jó napra esik. Ugyanaz a
 * szabály, mint a számlalistáé (`ownIssueRange`). Bármelyik határ elhagyható; egyik sem: nincs szűrő.
 *
 * A HIBÁS DÁTUM 400, NEM CSENDES KIHAGYÁS: a `2026-02-30` alakra illeszkedik, de nem létező nap, és egy csendben eldobott szűrő
 * a teljes listát adná, úgy, mintha a szűrő működne. A fordított tartomány (kezdő a záró után) is 400: üres találat lenne,
 * és a felhasználó nem tudná, hogy a szűrője a hibás, nem a lista üres.
 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDay(value: string): Date {
  const match = DAY.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day, 12));
    if (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    )
      return probe;
  }
  throw new BadRequestException(
    "A dátum alakja ÉÉÉÉ-HH-NN, és létező napnak kell lennie.",
  );
}

export function worksheetCreatedRange(
  from?: string,
  to?: string,
): Prisma.WorksheetWhereInput {
  if (!from && !to) return {};
  const start = from ? validDay(from) : null;
  const end = to ? validDay(to) : null;
  if (start && end && start.getTime() > end.getTime())
    throw new BadRequestException(
      "A kezdő dátum a záró dátum utáni napra esik.",
    );
  const range: Prisma.DateTimeFilter = {};
  if (start) range.gte = startOfBudapestDay(start);
  if (end) range.lt = startOfBudapestDay(end, 1);
  return { createdAt: range };
}
