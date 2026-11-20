import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { formatFillPlan } from "./supplier-bank-account-fill.js";
import {
  planSupplierFills,
  writeFills,
} from "./supplier-bank-account-fill.loader.js";

/**
 * A HIÁNYZÓ SZÁLLÍTÓI BANKSZÁMLASZÁM KITÖLTÉSE (acrobot 58553, kártya 4900497b; task os-lejaro-bankszamla-potlas-20261120).
 *
 *   pnpm --filter @acropora/api billing:supplier-account-fill                     (száraz, az alap)
 *   pnpm --filter @acropora/api billing:supplier-account-fill -- --apply          (ír)
 *   pnpm --filter @acropora/api billing:supplier-account-fill -- --undo --ids a,b (visszavon: törli a megnevezett kitöltéseket)
 *
 * ALAPBÓL SZÁRAZ. Az `--apply` CSAK a `SupplierBankAccountFill` táblába ír, szállítónként egy sort, és csak ha a szállítónak nincs számlaszáma (a soraiban, a szállító-törzsben, egy korábbi
 * kitöltésben) ÉS pontosan egy különböző jelölt van a számla PDF-jéből és a korábbi, NAV-számlához párosított terhelésekből együtt. Meglévő számlaszámot SOHA nem ír felül, a számla sorához
 * és a szállító-törzshöz nem nyúl; ellentmondó jelöltnél nem ír, kiírja. A kimenet CSAK darabszám, a számlaszám vége (négy jegy), a forrás és a szállító neve; az `--apply` kiírja a létrejött
 * sorok azonosítóit is (az `--undo --ids` ezeket törli). A lista még NEM használja a kitöltést.
 */
async function main(argv: readonly string[]): Promise<number> {
  const out = (text: string) => process.stdout.write(text);

  if (argv.includes("--undo")) {
    const at = argv.indexOf("--ids");
    const value = at >= 0 ? (argv[at + 1] ?? "") : "";
    const ids = (value.startsWith("--") ? "" : value)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      process.stderr.write("Az --undo-hoz add meg: --ids id1,id2\n");
      return 2;
    }
    const { count } = await prisma.supplierBankAccountFill.deleteMany({
      where: { id: { in: ids } },
    });
    out(`visszavonva: ${count} / ${ids.length} kitöltés\n`);
    return 0;
  }

  const apply = argv.includes("--apply");
  const plan = await planSupplierFills(prisma, {
    lines: (content) => pdfTextLines(content),
  });
  out(formatFillPlan(plan, apply));
  if (!apply) return 0;
  const written = await writeFills(prisma, plan);
  out(
    `\nírva: ${written.created} / ${plan.write} kitöltés; azonosítók (visszavonáshoz): ${written.ids.join(",")}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      process.stderr.write(`${String(cause)}\n`);
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
