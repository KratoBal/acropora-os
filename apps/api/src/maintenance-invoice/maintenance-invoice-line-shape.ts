import { Prisma } from "@acropora/database";

/**
 * A PISZKOZAT SORAINAK ALAKJA = A MOST KIÁLLÍTANDÓ TÉTELEK ALAKJA (barracuda L7, acrobot 61289; kártya 4a59885d). A kiállítás az
 * igazolásból újra leképezi a tételeket, és eddig csak az ÖSSZEGEKET vetette össze a piszkozatéval: egy olyan piszkozat, aminek az
 * előnézete a régi alakkal készült ("1 db, 900 000"), ugyanazzal az összeggel az új alakkal ("2 alkalom x 450 000") állt volna ki,
 * vagyis nem azt, amit az előnézet mutatott. A piszkozat tárolt sorai a KIMENT tétel mására (mennyiség, egység, egységár;
 * `createDraft`), tehát ezek az előnézet alakját tárolják: ha a mostani tételek mennyisége, egysége vagy egységára eltér tőlük,
 * a kiállítás megáll, és új piszkozatot kér (a törlés és a "Piszkozat készítése" ezt adja).
 *
 * A SORREND NEM SZÁMÍT (a tárolt sorok sorrendje nem garantált): a két oldal rendezett lenyomata egyezik-e. A mennyiség hat, az
 * egységár négy tizedesre normalizált (a tárolt oszlopok pontossága), hogy "2" és "2.000000" ugyanaz legyen.
 */
export function lineShapeKey(line: {
  description: string;
  quantity: Prisma.Decimal | number | string;
  /** A tárolt sor egysége lehet üres (régi sor): az üres NEM egyezik a kiment egységgel. */
  unit: string | null;
  unitNet: Prisma.Decimal | number | string;
}): string {
  return [
    line.description,
    new Prisma.Decimal(line.quantity).toFixed(6),
    line.unit ?? "",
    new Prisma.Decimal(line.unitNet).toFixed(4),
  ].join("|");
}

export function sameLineShape(
  stored: readonly {
    description: string;
    quantity: Prisma.Decimal;
    unit: string | null;
    unitNet: Prisma.Decimal;
  }[],
  current: readonly {
    name: string;
    quantity: number;
    unit: string;
    netUnitPrice: number;
  }[],
): boolean {
  if (stored.length !== current.length) return false;
  const left = stored.map(lineShapeKey).sort();
  const right = current
    .map((item) =>
      lineShapeKey({
        description: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unitNet: item.netUnitPrice,
      }),
    )
    .sort();
  return left.every((key, index) => key === right[index]);
}

export const LINE_SHAPE_CHANGED_MESSAGE =
  "A piszkozat előnézete a tételek régebbi alakjával készült (a mennyiség, az egység vagy az egységár más, mint amit most kiállítanánk), ezért nem azt állítanád ki, amit az előnézet mutatott. Töröld a piszkozatot, és készíts újat.";
