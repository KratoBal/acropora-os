import { BadRequestException, ConflictException } from "@nestjs/common";

/**
 * AZ EGYSZERRE ÉRKEZŐ ÍRÁSOK KÖZÖS VÉDELME (kártya 0d73f1b8, T3.3; Balázs 2026-11-03,
 * barracuda ötlete). Ha két kolléga egyszerre szerkeszti ugyanazt a sort, az egyik írás csendben
 * felülírja a másikét. A védelem a repóban már 34 helyen megvan ugyanabban az alakban
 * (`updateMany({ where: { id, updatedAt: <amit a kliens látott> } })`, és ha a találat nem
 * pontosan egy sor, 409), de mindenhol saját üzenettel és saját kóddal, és egy új író
 * végpontnak nincs mit másolnia. Ez az egy hely: egy kifejezés, egy hibakód, egy üzenet.
 *
 * EZ NEM ZÁR, HANEM A KLIENS ÁLLAPOTÁHOZ KÖTÉS: az írás csak arra a sorra megy, amelyiknek az
 * `updatedAt`-je pontosan az, amit a kliens betöltött. Ha azóta valaki más írt, a sor
 * `updatedAt`-je más, a találat nulla, az írás NEM történik meg, a kliens pedig 409-et kap, és
 * újratöltheti a friss állapotot.
 *
 * MIKOR NEM KELL: ahol az utolsó írás nyer a szándék (egy beállítás, egy értesítési kapcsoló),
 * és ahol az írás a sor saját állapotgépe szerint egyirányú (ott az állapot a feltétel, nem az
 * idő). Aki új író végpontot ír, a döntést kimondja a kódban; a tesztje a
 * `src/testing/stale-write.ts` sablonjával egy sorban mérhető.
 */
export const STALE_WRITE_CODE = "STALE_WRITE";

/** A kliens által látott állapot elavult: 409, a kód a felületnek szól, az üzenet az embernek. */
export class StaleWriteException extends ConflictException {
  constructor(subject = "Az adat") {
    super({
      code: STALE_WRITE_CODE,
      message: `${subject} közben megváltozott. Töltsd újra, és próbáld újra.`,
    });
  }
}

/** Egy Prisma-delegate, amennyit a védelem használ (a teszt ezt cseréli). */
export interface VersionedModel {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/**
 * A kliens által küldött `expectedUpdatedAt` időponttá alakítva. Hiányzó vagy érvénytelen érték
 * 400, mert egy írás, ami nem mondja meg, melyik állapotot látta, nem védhető: nem lehet csendben
 * „bármelyik állapotra” írni.
 */
export function expectedUpdatedAtOf(
  value: string | Date | null | undefined,
): Date {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "string" ? value : NaN);
  if (!value || Number.isNaN(date.getTime()))
    throw new BadRequestException(
      "Az expectedUpdatedAt hiányzik vagy nem érvényes időpont.",
    );
  return date;
}

/**
 * AZ ÍRÁS, CSAK A LÁTOTT ÁLLAPOTRA. `extraWhere` a sor további feltételei (például az állapot,
 * amiben szerkeszthető). A találat pontosan egy sor kell legyen: nulla = valaki közben írt (vagy
 * a sor megszűnt, vagy az extra feltétel nem áll), és az írás nem történt meg; ennél több nem
 * lehet (az `id` egyedi), de ha mégis, az hiba, nem siker.
 */
export async function writeIfUnchanged(
  model: VersionedModel,
  input: {
    id: string;
    expectedUpdatedAt: string | Date | null | undefined;
    extraWhere?: Record<string, unknown>;
    /** „A számla”, „A leltársor”: az üzenet alanya. */
    subject?: string;
  },
  data: Record<string, unknown>,
): Promise<void> {
  const expected = expectedUpdatedAtOf(input.expectedUpdatedAt);
  const written = await model.updateMany({
    where: { id: input.id, ...(input.extraWhere ?? {}), updatedAt: expected },
    data,
  });
  if (written.count === 0) throw new StaleWriteException(input.subject);
  if (written.count !== 1)
    throw new Error(
      `writeIfUnchanged: ${written.count} sor módosult egy azonosítóra (id=${input.id})`,
    );
}
