import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";
import { POS_MANUAL_LINE_SKU } from "@acropora/types";

import { recordOwnPrice } from "../products/price-history/own-price-history.js";
import { DEMO_PREFIX, demoPlan, type DemoPlan } from "./demo-data.plan.js";

/**
 * SYNTHETIC DEMO ROWS FOR THE STAGE, LOADED AND REMOVED BY ONE COMMAND (card c958804d, T6.3).
 *
 *   node dist/demo-data/demo-data.cli.js                              # the plan, writes nothing
 *   node dist/demo-data/demo-data.cli.js --apply  --db-host <host>    # loads the missing rows
 *   node dist/demo-data/demo-data.cli.js --remove --db-host <host>    # removes every DEMO- row
 *
 * THE GUARD IS TWO THINGS, AND THE FIRST ONE IS THE ONE THAT SEPARATES THE ENVIRONMENTS
 * (barracuda, #2104 review):
 *
 *  1. `DEMO_DATA_ALLOWED=stage` in the environment. It is set in the stage's environment only;
 *     `.env.example` and `.env.production.example` carry it EMPTY (a spec pins both). Nothing
 *     in the repo tells the stage from production otherwise (no `APP_ENV`, both run with
 *     `NODE_ENV=production`), and the anonymisation chain (card 07b56a1f) leaves no trace in
 *     the database yet. The weakness: the stage's `.env` copied onto production would carry the
 *     signal there, and that is why the second part exists.
 *  2. `--db-host <host>`, equal to the host in `DATABASE_URL`: the operator names the database
 *     on purpose. A hostname alone cannot separate the environments (a container deployment
 *     names the database service the same on both), so this part is a deliberate act, not a
 *     detector.
 *
 * IDEMPOTENT: a row whose business key exists is left alone, so a second `--apply` writes
 * nothing and says so. `--remove` deletes the `DEMO-` rows and nothing else.
 */

export interface DemoCounts {
  customers: number;
  quotes: number;
  posSales: number;
  incomingInvoices: number;
  /** products with their own price history and a running own sale (the Omnibus demo) */
  products: number;
}

export interface DemoStore {
  /** Loads what is missing; returns how many rows of each kind it CREATED. */
  apply(plan: DemoPlan): Promise<DemoCounts>;
  /** Removes every `DEMO-` row; returns how many it DELETED. */
  remove(): Promise<DemoCounts>;
}

export interface DemoOutput {
  stdout: (t: string) => void;
  stderr: (t: string) => void;
}

export interface DemoDeps {
  databaseUrl: string | undefined;
  /**
   * `DEMO_DATA_ALLOWED`: the stage-only signal. A write needs it to be exactly `stage`. It is
   * set in the stage's environment and left empty in `.env.example` and
   * `.env.production.example`, so a production environment does not carry it.
   */
  allowed: string | undefined;
  /** the Budapest calendar day, `YYYY-MM-DD` */
  today: string;
  store: () => DemoStore;
}

/** The host part of a Postgres URL, lower-case; `null` when it cannot be read. */
export function hostOfDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

const describe = (counts: DemoCounts) =>
  `${counts.customers} ügyfél, ${counts.quotes} ajánlat, ${counts.posSales} POS eladás, ${counts.incomingInvoices} bejövő számla, ${counts.products} termék árelőzménnyel`;

export async function runDemoData(
  argv: readonly string[],
  out: DemoOutput,
  deps: DemoDeps,
): Promise<number> {
  const apply = argv.includes("--apply");
  const remove = argv.includes("--remove");
  const hostAt = argv.indexOf("--db-host");
  const givenRaw = hostAt >= 0 ? argv[hostAt + 1] : undefined;
  const given = givenRaw?.toLowerCase();
  const known = new Set(["--apply", "--remove", "--db-host", givenRaw ?? ""]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    out.stderr(`Ismeretlen argumentum: ${unknown.join(" ")}\n`);
    return 1;
  }
  if (apply && remove) {
    out.stderr("Az --apply és a --remove együtt nem adható meg.\n");
    return 1;
  }

  const plan = demoPlan(deps.today);
  if (!apply && !remove) {
    out.stdout(
      `Terv (nem ír semmit): ${describe({
        customers: plan.customers.length,
        quotes: plan.quotes.length,
        posSales: plan.posSales.length,
        incomingInvoices: plan.incomingInvoices.length,
        products: plan.products.length,
      })}.\n`,
    );
    for (const c of plan.customers)
      out.stdout(`  ügyfél   ${c.customerNumber}\n`);
    for (const q of plan.quotes) out.stdout(`  ajánlat  ${q.quoteNumber}\n`);
    for (const p of plan.posSales) out.stdout(`  POS      ${p.orderNumber}\n`);
    for (const i of plan.incomingInvoices)
      out.stdout(`  számla   ${i.documentNumber}\n`);
    for (const p of plan.products) out.stdout(`  termék   ${p.sku}\n`);
    out.stdout("Íráshoz: --apply --db-host <az adatbázis gépneve>.\n");
    return 0;
  }

  const actual = hostOfDatabaseUrl(deps.databaseUrl);
  if (!actual) {
    out.stderr("A DATABASE_URL hiányzik vagy nem olvasható: nem írok.\n");
    return 1;
  }
  if (deps.allowed !== "stage") {
    out.stderr(
      "A DEMO_DATA_ALLOWED=stage jel hiányzik a környezetből: nem írok. Ezt csak a stage környezete állítja be.\n",
    );
    return 1;
  }
  if (!given) {
    out.stderr(
      `Íráshoz meg kell adni a --db-host <gépnév> értéket (a DATABASE_URL gépe: ${actual}).\n`,
    );
    return 1;
  }
  if (given !== actual) {
    out.stderr(
      `A megadott --db-host (${given}) nem egyezik a DATABASE_URL gépével (${actual}): nem írok.\n`,
    );
    return 1;
  }

  const store = deps.store();
  if (remove) {
    const removed = await store.remove();
    out.stdout(`Törölve: ${describe(removed)}.\n`);
    return 0;
  }
  const created = await store.apply(plan);
  const nothing =
    created.customers +
      created.quotes +
      created.posSales +
      created.incomingInvoices +
      created.products ===
    0;
  out.stdout(
    nothing
      ? "Mind megvan már, nem írtam semmit.\n"
      : `Létrehozva: ${describe(created)}.\n`,
  );
  return 0;
}

type Tx = Prisma.TransactionClient;

/** The Prisma side. Every lookup is by the `DEMO-` prefix of the row's own business key. */
export function prismaDemoStore(db: typeof prisma): DemoStore {
  const prefix = { startsWith: DEMO_PREFIX };
  return {
    async apply(plan) {
      return db.$transaction(async (tx: Tx) => {
        const counts: DemoCounts = {
          customers: 0,
          quotes: 0,
          posSales: 0,
          incomingInvoices: 0,
          products: 0,
        };

        const customerIds = new Map<string, string>();
        for (const row of await tx.customer.findMany({
          where: { customerNumber: prefix },
          select: { id: true, customerNumber: true },
        }))
          customerIds.set(row.customerNumber, row.id);
        for (const customer of plan.customers) {
          if (customerIds.has(customer.customerNumber)) continue;
          const created = await tx.customer.create({
            data: customer,
            select: { id: true },
          });
          customerIds.set(customer.customerNumber, created.id);
          counts.customers++;
        }

        const quoteNumbers = new Set(
          (
            await tx.quote.findMany({
              where: { quoteNumber: prefix },
              select: { quoteNumber: true },
            })
          ).map((q) => q.quoteNumber),
        );
        for (const quote of plan.quotes) {
          if (quoteNumbers.has(quote.quoteNumber)) continue;
          const customerId = customerIds.get(quote.customerNumber);
          if (!customerId)
            throw new Error(`Nincs ilyen demo ügyfél: ${quote.customerNumber}`);
          const created = await tx.quote.create({
            data: {
              quoteNumber: quote.quoteNumber,
              title: quote.title,
              customerId,
              versions: {
                create: {
                  versionNumber: 1,
                  validUntil: new Date(`${quote.validUntil}T00:00:00Z`),
                  currency: "HUF",
                  priceDisplay: quote.priceDisplay,
                  milestones: {
                    create: quote.milestones.map((m, i) => ({
                      position: i + 1,
                      label: m.label,
                      percent: m.percent,
                    })),
                  },
                },
              },
            },
            select: { id: true, versions: { select: { id: true } } },
          });
          const versionId = created.versions[0]!.id;
          for (const [blockIndex, block] of quote.blocks.entries()) {
            const blockRow = await tx.quoteBlock.create({
              data: {
                versionId,
                position: blockIndex + 1,
                kind: "SECTION",
                title: block.title,
              },
              select: { id: true },
            });
            await tx.quoteItem.createMany({
              data: block.items.map((item, i) => ({
                versionId,
                blockId: blockRow.id,
                position: i + 1,
                source: "STANDALONE" as const,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                unitNetPrice: item.unitNetPrice,
                vatRatePercent: item.vatRatePercent,
                isOptional: item.isOptional,
              })),
            });
          }
          await tx.quoteEvent.create({
            data: {
              quoteId: created.id,
              versionId,
              kind: "CREATED",
              payload: {
                quoteNumber: quote.quoteNumber,
                versionNumber: 1,
                outcome: "DEMO",
              },
            },
          });
          counts.quotes++;
        }

        const orderNumbers = new Set(
          (
            await tx.salesOrder.findMany({
              where: { orderNumber: prefix },
              select: { orderNumber: true },
            })
          ).map((o) => o.orderNumber),
        );
        for (const sale of plan.posSales) {
          if (orderNumbers.has(sale.orderNumber)) continue;
          const customerId = sale.customerNumber
            ? customerIds.get(sale.customerNumber)
            : null;
          if (sale.customerNumber && !customerId)
            throw new Error(`Nincs ilyen demo ügyfél: ${sale.customerNumber}`);
          const at = new Date(sale.completedAt);
          await tx.salesOrder.create({
            data: {
              orderNumber: sale.orderNumber,
              channel: "POS",
              status: "COMPLETED",
              customerId: customerId ?? null,
              paymentMethod: sale.paymentMethod,
              currency: "HUF",
              totalNet: sale.totalNet,
              totalTax: sale.totalTax,
              totalGross: sale.totalGross,
              discountPercent: sale.discountPercent,
              orderedAt: at,
              confirmedAt: at,
              completedAt: at,
              lines: {
                create: sale.lines.map((line) => ({
                  variantId: null,
                  sku: POS_MANUAL_LINE_SKU,
                  description: line.description,
                  quantity: line.quantity,
                  unit: "db",
                  unitNet: (
                    Number(line.unitGross) /
                    (1 + line.vatRate / 100)
                  ).toFixed(4),
                  taxRate: String(line.vatRate),
                  lineGross: (
                    Number(line.unitGross) *
                    Number(line.quantity) *
                    (1 - Number(line.discountPercent ?? 0) / 100)
                  ).toFixed(4),
                  discountPercent: line.discountPercent,
                  // no stock behind a manual line, so nothing is ever pushed to UNAS
                  syncStatus: "OK" as const,
                })),
              },
            },
          });
          counts.posSales++;
        }

        const externalIds = new Set(
          (
            await tx.incomingBillingDocument.findMany({
              where: { externalId: prefix },
              select: { externalId: true },
            })
          ).map((d) => d.externalId),
        );
        for (const invoice of plan.incomingInvoices) {
          if (externalIds.has(invoice.externalId)) continue;
          await tx.incomingBillingDocument.create({ data: invoice });
          counts.incomingInvoices++;
        }

        const variantSkus = new Set(
          (
            await tx.productVariant.findMany({
              where: { sku: prefix },
              select: { sku: true },
            })
          ).map((v) => v.sku),
        );
        for (const product of plan.products) {
          if (variantSkus.has(product.sku)) continue;
          const sale = product.sale;
          const latest = product.history[product.history.length - 1]!;
          const created = await tx.product.create({
            data: {
              name: product.name,
              type: "PHYSICAL",
              origin: "LOCAL",
              catalogAuthority: "ACROPORA",
              // inert: neither a projection round nor a stock push may pick the demo product up
              webshopSellable: false,
              webshopExcluded: true,
              variants: {
                create: {
                  sku: product.sku,
                  unit: "db",
                  vatRate: "27",
                  sellingGrossPrice: String(latest.gross),
                  sellingPriceCurrency: "HUF",
                  sellingSaleGrossPrice: String(sale.gross),
                  sellingSaleStartsAt: sale.startsAt,
                  sellingSaleEndsAt: sale.endsAt,
                },
              },
            },
            select: { id: true, variants: { select: { id: true } } },
          });
          const variantId = created.variants[0]!.id;
          // the same writer the price editor uses, oldest row first: a backdated history
          // that reads like a real one (a row only where the price or the sale changed)
          const rows = [
            ...product.history.map((h) => ({
              at: h.at,
              gross: h.gross,
              sale: null as number | null,
            })),
            { at: sale.startsAt, gross: latest.gross, sale: sale.gross },
          ];
          for (const row of rows)
            await recordOwnPrice(tx, {
              productId: created.id,
              variantId,
              currency: "HUF",
              grossPrice: new Prisma.Decimal(row.gross),
              saleGrossPrice:
                row.sale === null ? null : new Prisma.Decimal(row.sale),
              observedAt: row.at,
            });
          counts.products++;
        }
        return counts;
      });
    },

    async remove() {
      return db.$transaction(async (tx: Tx) => {
        const quotes = await tx.quote.findMany({
          where: { quoteNumber: prefix },
          select: { id: true },
        });
        const quoteIds = quotes.map((q) => q.id);
        const versions = await tx.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        });
        const versionIds = versions.map((v) => v.id);
        await tx.quoteEvent.deleteMany({
          where: { quoteId: { in: quoteIds } },
        });
        await tx.quoteItem.deleteMany({
          where: { versionId: { in: versionIds } },
        });
        await tx.quotePaymentMilestone.deleteMany({
          where: { versionId: { in: versionIds } },
        });
        await tx.quoteBlock.deleteMany({
          where: { versionId: { in: versionIds } },
        });
        await tx.quoteVersion.deleteMany({ where: { id: { in: versionIds } } });
        await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
        const sales = await tx.salesOrder.deleteMany({
          where: { orderNumber: prefix },
        });
        const invoices = await tx.incomingBillingDocument.deleteMany({
          where: { externalId: prefix },
        });
        // the variants and the history rows go with the product (onDelete: Cascade)
        const products = await tx.product.deleteMany({
          where: { variants: { some: { sku: prefix } } },
        });
        const customers = await tx.customer.deleteMany({
          where: { customerNumber: prefix },
        });
        return {
          customers: customers.count,
          quotes: quoteIds.length,
          posSales: sales.count,
          incomingInvoices: invoices.count,
          products: products.count,
        };
      });
    },
  };
}

/** The Budapest calendar day, `YYYY-MM-DD`. */
export function budapestDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function main(): Promise<void> {
  const code = await runDemoData(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      databaseUrl: process.env.DATABASE_URL,
      allowed: process.env.DEMO_DATA_ALLOWED,
      today: budapestDay(),
      store: () => prismaDemoStore(prisma),
    },
  );
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
