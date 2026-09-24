import { Prisma } from "@acropora/database";

/**
 * A szerződés éves díja számított érték. Szándékosan nem tároljuk: a tárolt
 * összeg az egységár, mennyiség vagy alkalomszám későbbi javításakor csendben
 * elavulna. A Prisma Decimal itt végig megmarad, ezért a pénz nem JS float.
 */
export function contractItemYearlyNet(input: {
  unitNet: Prisma.Decimal | string;
  quantity: Prisma.Decimal | string;
  occasionsPerYear: number;
}): Prisma.Decimal {
  return new Prisma.Decimal(input.unitNet)
    .mul(new Prisma.Decimal(input.quantity))
    .mul(input.occasionsPerYear);
}
