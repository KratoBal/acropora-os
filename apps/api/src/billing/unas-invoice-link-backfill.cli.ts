import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";
import type { UnasApiOrder } from "@acropora/types";

import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import { UnasConnectionRepository } from "../imports/unas/unas-connection.repository.js";
import { UnasCredentialCryptoService } from "../imports/unas/unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "../imports/unas/unas-credential.provider.js";
import { UnasClock } from "../imports/unas/unas-login-expiry.js";
import {
  UNAS_INVOICE_LINK_USAGE,
  backfillInvoiceLinks,
  newInvoiceLinkReport,
  type InvoiceLinkStore,
} from "./unas-invoice-link-backfill.js";

/** A UNAS egy getOrder-lapja legfeljebb ennyi rendelés (a UNAS saját felső határa). */
export const PAGE_SIZE = 500;
/** Két UNAS-kérés között (Balázs, 2026-11-20 13:21 UTC: a külső kiolvasás lassan menjen). */
export const PAGE_GAP_MS = 2_000;
/** Ennyi lap fölött hiba, nem csendes vágás: egy félév rendelései ennél jóval kevesebb lapon férnek el. */
export const MAX_PAGES = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayStartSeconds = (day: string): number | null => {
  if (!DAY.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day
    ? null
    : Math.floor(at / 1000);
};

export interface BackfillDeps {
  /** Egy getOrder-lap a módosítási ablakra; a token a hívás dolga. */
  page?: (request: {
    timeModStart: number;
    timeModEnd?: number;
    limitStart: number;
    limitNum: number;
  }) => Promise<UnasApiOrder[]>;
  store?: InvoiceLinkStore;
  sleep?: (ms: number) => Promise<void>;
}

export async function main(
  argv: readonly string[],
  io: { out: (text: string) => void; err: (text: string) => void },
  deps: BackfillDeps = {},
): Promise<number> {
  if (argv.includes("--help")) {
    io.out(UNAS_INVOICE_LINK_USAGE);
    return 0;
  }
  const known = new Set(["--tol", "--ig", "--elotag", "--apply"]);
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!known.has(flag)) {
      io.err(`Ismeretlen kapcsolo: ${flag}\n${UNAS_INVOICE_LINK_USAGE}`);
      return 2;
    }
    if (flag === "--apply") continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      io.err(`A ${flag} utan ertek kell.\n`);
      return 2;
    }
    values.set(flag, value);
    i++;
  }
  const apply = argv.includes("--apply");
  const from = dayStartSeconds(values.get("--tol") ?? "");
  const untilText = values.get("--ig");
  const until =
    untilText === undefined ? undefined : dayStartSeconds(untilText);
  if (
    from === null ||
    until === null ||
    (until !== undefined && until <= from)
  ) {
    io.err(
      `A --tol kotelezo, es mindket nap EEEE-HH-NN alaku, a --ig a --tol utan.\n`,
    );
    return 2;
  }
  const prefix = values.get("--elotag") ?? null;

  const page = deps.page ?? (await unasPage());
  const store = deps.store ?? prismaInvoiceLinkStore;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  io.out(
    `${apply ? "ELES" : "SZARAZ"}: UNAS-rendelesek, modositva ${values.get("--tol")} .. ${untilText ?? "most"}${prefix ? `, szam-elotag ${prefix}` : ""}\n`,
  );
  const report = newInvoiceLinkReport();
  for (let index = 0; ; index++) {
    if (index >= MAX_PAGES) {
      io.err(
        `Tobb mint ${MAX_PAGES} lap: megalltam, szukitsd az ablakot (--ig).\n`,
      );
      return 2;
    }
    if (index > 0) await sleep(PAGE_GAP_MS);
    const orders = await page({
      timeModStart: from,
      ...(until !== undefined ? { timeModEnd: until } : {}),
      limitStart: index * PAGE_SIZE,
      limitNum: PAGE_SIZE,
    });
    await backfillInvoiceLinks({
      orders,
      store,
      apply,
      prefix,
      out: io.out,
      report,
    });
    if (orders.length < PAGE_SIZE) break;
  }
  const c = report.counts;
  io.out(
    `Osszesen: ${report.orders} rendeles; szamla nelkul ${c.NINCS_SZAMLA}, mar megvolt ${c.MAR_VAN}, ` +
      (apply
        ? `link potolva ${c.LINK_POTOLVA}, uj sor ${c.SOR_IRVA}, kozben megvolt ${c.KOZBEN_MEGVOLT}\n`
        : `link potolna ${c.LINK_POTOLNA}, uj sor lenne ${c.SOR_LENNE}\nEz a futas nem irt. Az irashoz: --apply\n`),
  );
  return !apply && c.LINK_POTOLNA + c.SOR_LENNE > 0 ? 1 : 0;
}

async function unasPage(): Promise<NonNullable<BackfillDeps["page"]>> {
  const client = new UnasApiClient();
  const auth = new UnasAuthService(
    client,
    new UnasCredentialProvider(
      new UnasConnectionRepository(),
      new UnasCredentialCryptoService(),
    ),
    new UnasClock(),
  );
  return async (request) => client.getOrderPage(await auth.getToken(), request);
}

/**
 * AZ ÍRÁS KÉT FELTÉTELES MŰVELET, MÁS NINCS: a link csak üres linkű sorra kerül (`updateMany ... externalUrl: null`), az új sor
 * a (source, szám) egyedi kulcson ütközve nem ír semmit. A rendelés-szinkron ugyanígy hozza létre (OUTBOUND, INVOICE, UNAS,
 * RECEIVED), tehát a következő szinkron-látás ugyanazt a sort frissíti, nem duplikál.
 */
export const prismaInvoiceLinkStore: InvoiceLinkStore = {
  async existing(number) {
    const row = await prisma.invoice.findUnique({
      where: {
        source_invoiceNumber: { source: "UNAS", invoiceNumber: number },
      },
      select: { externalUrl: true },
    });
    return row ? { hasUrl: Boolean(row.externalUrl) } : null;
  },
  async localOrderId(order) {
    for (const externalId of [order.id, order.key]) {
      if (!externalId) continue;
      const reference = await prisma.externalReference.findUnique({
        where: {
          system_entityType_externalId: {
            system: "UNAS",
            entityType: "SalesOrder",
            externalId,
          },
        },
        select: { entityId: true },
      });
      if (!reference) continue;
      const local = await prisma.salesOrder.findUnique({
        where: { id: reference.entityId },
        select: { id: true, unasDeletedAt: true },
      });
      return local && !local.unasDeletedAt ? local.id : null;
    }
    return null;
  },
  async setUrlIfEmpty(number, url) {
    const { count } = await prisma.invoice.updateMany({
      where: { source: "UNAS", invoiceNumber: number, externalUrl: null },
      data: { externalUrl: url },
    });
    return count === 1;
  },
  async create(input) {
    try {
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          documentType: "INVOICE",
          source: "UNAS",
          invoiceNumber: input.number,
          partnerName: input.partnerName,
          partnerTaxNumber: input.partnerTaxNumber,
          salesOrderId: input.salesOrderId,
          currency: input.currency,
          externalUrl: input.url,
          syncStatus: "RECEIVED",
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return false;
      throw error;
    }
  },
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // only the error's name and code: a UNAS error message may carry the request
      const failure = error as { name?: unknown; code?: unknown } | null;
      process.stderr.write(
        `UNAS-hiba: ${typeof failure?.name === "string" ? failure.name : "ismeretlen"}${typeof failure?.code === "string" ? ` ${failure.code}` : ""}\n`,
      );
      process.exitCode = 2;
    })
    .finally(() => void prisma.$disconnect());
}
