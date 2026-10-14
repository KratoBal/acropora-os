import { pathToFileURL } from "node:url";

import { contractBilling, type ContractBilledLine } from "@acropora/types";
import { prisma } from "@acropora/database";

import {
  contractBilledLines,
  invoiceCountsAsContractBilled,
} from "./contract-billed-lines.js";

/**
 * A MÁR KIÁLLÍTOTT SZERZŐDÉSES SZÁMLÁK SORAINAK ÖSSZEKÖTÉSE A TÉTELEKKEL
 * (feladat t-20261014-szerzodesek-reszteljesitese-szamlazasa-d510).
 *
 * A részteljesítés a számlasor `contractItemId` mezőjéből számol. Ami a mező
 * előtt készült (Balázs 2026-10-14-i részszámlája), annak a sorai üresek: a
 * szerződés `sourceId`-n át tudja, hogy van számlája, de azt nem, melyik
 * tételből mennyi. Ez a parancs pótolja.
 *
 * A PÁROSÍTÁS: a sor leírása (szóközök nélkül, pontosan) és nettó egységára
 * egyezik a szerződés EGYETLEN tételével. Ha nulla vagy több tétel egyezik, a
 * sor kimarad, és a terv megmondja, miért: ilyenkor ember dönt, nem a parancs.
 *
 * ÉLES ÍRÁS: alapból csak TERV (mit kötne össze, és utána mi lenne a szerződés
 * állapota). Írni csak `--apply` mellett, és csak `--approval "<mire
 * hivatkozva>"` mellett -- a szöveg kiíródik, hogy a futás utólag
 * visszakereshető legyen. Csak ÜRES hivatkozást tölt ki: egy már összekötött
 * sort nem ír felül, tehát a második futás nulla sort ír, és ezt ki is mondja.
 *
 * Futtatás az api konténerben, az apps/api könyvtárból:
 *   node dist/contracts/contract-billing-link.cli.js <szerződésszám>
 *   node dist/contracts/contract-billing-link.cli.js <szerződésszám> --apply --approval "Balázs, <hol, mikor>"
 *
 * KILÉPÉSI KÓDOK: 0 lefutott; 1 hiba; 2 rossz hívás (nincs szám, vagy --apply --approval nélkül).
 */
export interface CliOutput {
  stdout: (t: string) => void;
  stderr: (t: string) => void;
}

export interface LinkContractItem {
  id: string;
  position: number;
  description: string;
  unitNet: string;
  quantity: string;
}

export interface LinkInvoiceLine {
  id: string;
  invoiceLabel: string;
  position: number | null;
  description: string;
  unitNet: string;
  quantity: string;
  /** Számlázottnak számít-e a bizonylat (invoiceCountsAsContractBilled, a lekérdezés szabálya). */
  counts: boolean;
}

export interface LinkPlan {
  links: Array<{ line: LinkInvoiceLine; item: LinkContractItem }>;
  skipped: Array<{ line: LinkInvoiceLine; reason: string }>;
}

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
const sameAmount = (a: string, b: string) => Number(a) === Number(b);

/** A párosítás terve, adatbázis nélkül. */
export function planContractBillingLinks(
  items: readonly LinkContractItem[],
  lines: readonly LinkInvoiceLine[],
): LinkPlan {
  const plan: LinkPlan = { links: [], skipped: [] };
  for (const line of lines) {
    const matches = items.filter(
      (item) =>
        same(item.description, line.description) &&
        sameAmount(item.unitNet, line.unitNet),
    );
    if (matches.length === 1) plan.links.push({ line, item: matches[0]! });
    else
      plan.skipped.push({
        line,
        reason:
          matches.length === 0
            ? "nincs egyező tétel (leírás és nettó egységár)"
            : `${matches.length} tétel egyezik, nem egyértelmű`,
      });
  }
  return plan;
}

export interface LinkDeps {
  contract(
    number: string,
  ): Promise<{ id: string; kind: string; items: LinkContractItem[] } | null>;
  /** A szerződés számláinak üres hivatkozású tétel-sorai. */
  unlinkedLines(contractId: string): Promise<LinkInvoiceLine[]>;
  /** A már összekötött, számlázottnak számító sorok (a terv utáni állapothoz). */
  billedLines(contractId: string): Promise<ContractBilledLine[]>;
  /** Csak `--apply` mellett; csak üres hivatkozást tölt ki. Az írt sorok száma. */
  link(lineId: string, contractItemId: string): Promise<number>;
}

function argValue(argv: readonly string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

export async function runContractBillingLinkCli(
  argv: readonly string[],
  out: CliOutput,
  deps: LinkDeps,
): Promise<number> {
  const number =
    argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--approval") ??
    null;
  const apply = argv.includes("--apply");
  const approval = argValue(argv, "--approval")?.trim() ?? "";
  if (!number) {
    out.stderr(
      'Használat: contract-billing-link.cli.js <szerződésszám> [--apply --approval "<mire hivatkozva>"]\n',
    );
    return 2;
  }
  if (apply && !approval) {
    out.stderr(
      'Az --apply csak --approval "<mire hivatkozva>" mellett ír (élő adat, esetenkénti engedély).\n',
    );
    return 2;
  }
  try {
    const contract = await deps.contract(number);
    if (!contract) {
      out.stderr(`Nincs ilyen szerződés: ${number}\n`);
      return 1;
    }
    if (contract.kind !== "PURCHASE") {
      out.stderr(
        `A(z) ${number} nem beszerzési szerződés; ennek a számlázását nem tételsorok követik.\n`,
      );
      return 1;
    }
    const lines = await deps.unlinkedLines(contract.id);
    const plan = planContractBillingLinks(contract.items, lines);
    out.stdout(
      `Szerződés ${number}: ${lines.length} összekötetlen számlasor, ${plan.links.length} egyértelmű, ${plan.skipped.length} kimarad.\n`,
    );
    for (const { line, item } of plan.links)
      out.stdout(
        // a nem számító bizonylat (vázlat, díjbekérő, sztornózott, végszámlás előleg)
        // sora is összekötődik (egy később kiállított vázlat így már számít), de
        // a terv KÜLÖN jelöli, hogy ma nem számít bele (barracuda, #1699)
        `  KÖT   ${line.invoiceLabel} ${line.position ?? "-"}. sor  "${line.description}" ${line.quantity}  ->  ${item.position}. tétel${line.counts ? "" : "  (ma nem számít bele: a bizonylat nem számlázottnak számító)"}\n`,
      );
    for (const { line, reason } of plan.skipped)
      out.stdout(
        `  KIHAGY ${line.invoiceLabel} ${line.position ?? "-"}. sor  "${line.description}": ${reason}\n`,
      );

    const after = contractBilling(
      contract.items.map((item) => ({ id: item.id, quantity: item.quantity })),
      [
        ...(await deps.billedLines(contract.id)),
        ...plan.links
          .filter(({ line }) => line.counts)
          .map(({ line, item }) => ({
            contractItemId: item.id,
            quantity: line.quantity,
          })),
      ],
    );
    out.stdout(`Az összekötés utáni állapot: ${after.state}\n`);
    for (const row of after.items) {
      const item = contract.items.find((i) => i.id === row.contractItemId)!;
      out.stdout(
        `  ${item.position}. tétel: szerződés ${row.quantity}, számlázva ${row.invoicedQuantity}, maradék ${row.remainingQuantity}${row.overInvoiced ? " (TÖBB, MINT A SZERZŐDÉS)" : ""}\n`,
      );
    }

    if (!apply) {
      out.stdout(
        'TERV: semmi nem íródott. Íráshoz: --apply --approval "<mire hivatkozva>".\n',
      );
      return 0;
    }
    out.stdout(`ÍRÁS, hivatkozás: ${approval}\n`);
    let written = 0;
    for (const { line, item } of plan.links)
      written += await deps.link(line.id, item.id);
    out.stdout(
      `${written} sor összekötve (${plan.links.length - written} közben már össze volt kötve, azt nem írta felül).\n`,
    );
    return 0;
  } catch (error) {
    out.stderr(
      `Hiba: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runContractBillingLinkCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      contract: async (number) => {
        const row = await prisma.contract.findUnique({
          where: { number },
          select: {
            id: true,
            kind: true,
            items: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                position: true,
                description: true,
                unitNet: true,
                quantity: true,
              },
            },
          },
        });
        return row
          ? {
              id: row.id,
              kind: row.kind,
              items: row.items.map((i) => ({
                ...i,
                unitNet: i.unitNet.toString(),
                quantity: i.quantity.toString(),
              })),
            }
          : null;
      },
      unlinkedLines: async (contractId) => {
        const rows = await prisma.invoiceLine.findMany({
          where: {
            kind: "ITEM",
            contractItemId: null,
            invoice: { sourceType: "CONTRACT", sourceId: contractId },
          },
          orderBy: [{ invoiceId: "asc" }, { position: "asc" }],
          select: {
            id: true,
            position: true,
            description: true,
            unitNet: true,
            quantity: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                documentType: true,
                direction: true,
                // a sztornók és (előlegnél) a végszámlák, a sztornójukkal: a
                // számlázott-szabály ugyanaz, mint a lekérdezésé
                correctionInvoices: {
                  where: { documentType: { in: ["STORNO", "FINAL_INVOICE"] } },
                  select: {
                    documentType: true,
                    status: true,
                    correctionInvoices: {
                      where: { documentType: "STORNO", status: "ISSUED" },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        });
        return rows.map((r) => ({
          id: r.id,
          invoiceLabel: `${r.invoice.invoiceNumber ?? r.invoice.id} (${r.invoice.documentType}, ${r.invoice.status})`,
          position: r.position,
          description: r.description,
          unitNet: r.unitNet.toString(),
          quantity: r.quantity.toString(),
          counts: invoiceCountsAsContractBilled({
            direction: r.invoice.direction,
            documentType: r.invoice.documentType,
            status: r.invoice.status,
            stornoed: r.invoice.correctionInvoices.some(
              (c) => c.documentType === "STORNO" && c.status === "ISSUED",
            ),
            finals: r.invoice.correctionInvoices
              .filter((c) => c.documentType === "FINAL_INVOICE")
              .map((f) => ({
                status: f.status,
                stornoed: f.correctionInvoices.length > 0,
              })),
          }),
        }));
      },
      billedLines: (contractId) => contractBilledLines(prisma, contractId),
      link: async (lineId, contractItemId) =>
        (
          await prisma.invoiceLine.updateMany({
            where: { id: lineId, contractItemId: null },
            data: { contractItemId },
          })
        ).count,
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
