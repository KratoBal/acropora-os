import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";
import {
  applyUnasShippingFlags,
  planUnasShippingFlags,
  SHIPPING_FLAGS,
  type ShippingFlag,
} from "./shipping-profile-sources.js";

/**
 * A SZÁLLÍTÁSI JELZŐK EGYSZERI FELTÖLTÉSE A UNAS-BÓL (a82ed229). Minden UNAS-os
 * termék kap egy sort a UNAS mai beállításával, `UNAS` forrással; a kézzel
 * állított jelzőhöz nem nyúl. Alapból SZÁRAZFUTÁS: kiírja, mi változna, és hol
 * tér el a kézi érték a UNAS-étól. `--apply` mellett kötegenként, tranzakcióban.
 * Idempotens: egy második futás nulla változást ad. Ugyanezt a szabályt futtatja
 * a UNAS-szinkron is, minden futásnál (`applyUnasShippingFlags`).
 *
 *     node dist/products/shipping-profile-fill.cli.js [--apply]
 */
const KOTEG = 200;

export interface ShippingFillReport {
  products: number;
  create: number;
  update: number;
  unchanged: number;
  /** Jelzőnként: hány terméken írna át a UNAS. */
  updatedFlags: Record<ShippingFlag, number>;
  /** Kézi jelző, ami eltér a UNAS-étól: a kézi marad, de látszik. */
  manualDiffers: { productId: string; flag: ShippingFlag }[];
}

type Db = Pick<
  typeof prisma,
  "unasProductSnapshot" | "productShippingProfile" | "$transaction"
>;

export async function main(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db: Db = prisma,
): Promise<number> {
  const ismeretlen = args.filter((a) => a !== "--apply");
  if (ismeretlen.length) {
    out.stderr(`Ismeretlen kapcsoló: ${ismeretlen.join(" ")} (csak --apply)\n`);
    return 1;
  }
  const apply = args.includes("--apply");
  const report: ShippingFillReport = {
    products: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    updatedFlags: {
      pickupOnly: 0,
      foxpostForbidden: 0,
      isHeavy: 0,
      isFrozen: 0,
    },
    manualDiffers: [],
  };
  let utolso: string | null = null;
  for (;;) {
    const sorok: { productId: string; rawPayload: unknown }[] =
      await db.unasProductSnapshot.findMany({
        where: utolso ? { productId: { gt: utolso } } : {},
        orderBy: { productId: "asc" },
        take: KOTEG,
        select: { productId: true, rawPayload: true },
      });
    if (sorok.length === 0) break;
    utolso = sorok.at(-1)!.productId;
    const meglevok = await db.productShippingProfile.findMany({
      where: { productId: { in: sorok.map((s) => s.productId) } },
    });
    const meglevo = new Map(meglevok.map((p) => [p.productId, p]));
    const valtozik: typeof sorok = [];
    for (const sor of sorok) {
      report.products++;
      const regi = meglevo.get(sor.productId) ?? null;
      const unas = unasShippingProfile(sor.rawPayload);
      const plan = planUnasShippingFlags(regi, unas);
      if (plan.kind === "create") report.create++;
      else if (plan.kind === "update") {
        report.update++;
        for (const flag of plan.flags) report.updatedFlags[flag]++;
      } else report.unchanged++;
      if (plan.kind !== "unchanged") valtozik.push(sor);
      if (regi)
        for (const flag of SHIPPING_FLAGS)
          if (
            regi[`${flag}Source`] === "MANUAL" &&
            regi[flag] !== (unas?.[flag] ?? false)
          )
            report.manualDiffers.push({ productId: sor.productId, flag });
    }
    if (apply && valtozik.length > 0)
      await db.$transaction(async (tx) => {
        for (const sor of valtozik)
          await applyUnasShippingFlags(tx, sor.productId, sor.rawPayload);
      });
  }
  out.stdout(describeShippingFill(report));
  out.stdout(
    apply
      ? `ALKALMAZVA: ${report.create} új sor, ${report.update} frissített\n`
      : "SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n",
  );
  return 0;
}

export function describeShippingFill(r: ShippingFillReport): string {
  const sorok = [
    `Termék a UNAS-tükörrel: ${r.products}`,
    `Új sor (eddig nem volt): ${r.create}`,
    `Frissül (UNAS-forrású jelző változott): ${r.update}`,
    ...SHIPPING_FLAGS.map((f) => `  ${f}: ${r.updatedFlags[f]}`),
    `Változatlan: ${r.unchanged}`,
    `Kézi jelző, ami eltér a UNAS-étól (marad a kézi): ${r.manualDiffers.length}`,
    ...r.manualDiffers.slice(0, 20).map((d) => `  ${d.productId} ${d.flag}`),
  ];
  return `${sorok.join("\n")}\n`;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Ismeretlen hiba."}\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    });
}
