import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  describeHandleSwitch,
  planHandleSwitch,
  type HandleSwitchRow,
} from "./medusa-handle-switch.js";
import { medusaHandleFromSlug } from "./medusa-product-handle.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import { handleFromWebshopSlug } from "./medusa-projection.runner.js";

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/** Egy kötött termék: a Medusa-azonosító és a két csatorna slugja. */
export interface HandleSource {
  productId: string;
  medusaId: string;
  unasSlug: string | null;
  webshopSlug: string | null;
}

export const prismaHandleSources = async (): Promise<HandleSource[]> => {
  const kotesek = await prisma.externalReference.findMany({
    where: { ...MEDUSA_PRODUCT_REFERENCE },
    select: { entityId: true, externalId: true },
  });
  const sorok = await prisma.channelListing.findMany({
    where: {
      productId: { in: kotesek.map((k) => k.entityId) },
      channel: { in: ["UNAS", "WEBSHOP"] },
    },
    select: { productId: true, channel: true, slug: true },
  });
  const slug = (id: string, csatorna: string) =>
    sorok.find((s) => s.productId === id && s.channel === csatorna)?.slug ??
    null;
  return kotesek.map((k) => ({
    productId: k.entityId,
    medusaId: k.externalId,
    unasSlug: slug(k.entityId, "UNAS"),
    webshopSlug: slug(k.entityId, "WEBSHOP"),
  }));
};

const LAP = 200;

/**
 * A HANDLE ÁTKAPCSOLÁSA (SEO P0 PR 7d), `pnpm medusa:handle-switch`.
 *
 * Alapból SZÁRAZFUTÁS: kiírja a tervet (hány változik, mi vár mire, ütközés,
 * kör). `--apply` függőségi sorrendben írja a handle-öket, csak a handle-t.
 * `--vissza` a régi, UNAS-alapú handle-öket írja vissza, ugyanígy.
 *
 * AZ IRÁNY ÉS A KAPCSOLÓ EGYEZZEN: `--apply` csak akkor ír, ha a
 * `MEDUSA_HANDLE_FROM_WEBSHOP_SLUG` ugyanarra áll (előre: `true`, vissza: nem
 * `true`). Különben a következő vetítési kör egy esedékes terméken csendben
 * visszaírná a másik handle-t, és a két út egymás ellen dolgozna.
 */
export async function runHandleSwitchCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    client(): Promise<MedusaAdminClient>;
    sources(): Promise<HandleSource[]>;
    env: Record<string, string | undefined>;
  },
): Promise<number> {
  const ismeretlen = argv.filter((a) => a !== "--apply" && a !== "--vissza");
  if (ismeretlen.length) {
    out.stderr(
      `Ismeretlen kapcsolo: ${ismeretlen.join(" ")} (csak --apply, --vissza)\n`,
    );
    return 1;
  }
  const apply = argv.includes("--apply");
  const vissza = argv.includes("--vissza");
  if (apply && handleFromWebshopSlug(deps.env) === vissza) {
    out.stderr(
      vissza
        ? "NEM IROK: --vissza mellett a MEDUSA_HANDLE_FROM_WEBSHOP_SLUG ne legyen true, kulonben a vetites visszairja az uj handle-t.\n"
        : "NEM IROK: elobb a MEDUSA_HANDLE_FROM_WEBSHOP_SLUG legyen true, kulonben a vetites visszairja a regi handle-t.\n",
    );
    return 1;
  }

  let client: MedusaAdminClient;
  try {
    client = await deps.client();
  } catch (error) {
    if (error instanceof MedusaConnectionError) {
      out.stderr(describeCredentialFailure(error) + "\n");
      return 1;
    }
    throw error;
  }

  // a bolt MINDEN termékének handle-je: egy nem kötött termék is foglalhat címet
  const mai = new Map<string, string>();
  const handlek = new Map<string, string>();
  // annyival lép, ahány termék TÉNYLEG jött: a szerver a `limit`-et levághatja
  for (let offset = 0; ;) {
    const lap = await client.listProductHandles(offset, LAP);
    for (const p of lap.products) {
      mai.set(p.id, p.handle);
      handlek.set(p.handle, p.id);
    }
    offset += lap.products.length;
    if (!lap.products.length || offset >= lap.count) break;
  }

  const rows: HandleSwitchRow[] = [];
  let celNelkul = 0;
  let boltbanNincs = 0;
  for (const f of await deps.sources()) {
    const current = mai.get(f.medusaId);
    if (current === undefined) {
      boltbanNincs += 1;
      continue;
    }
    const desired = medusaHandleFromSlug(vissza ? f.unasSlug : f.webshopSlug);
    if (!desired) {
      celNelkul += 1;
      continue;
    }
    rows.push({
      productId: f.productId,
      medusaId: f.medusaId,
      current,
      desired,
    });
  }
  const plan = planHandleSwitch(rows, handlek);
  out.stdout(
    `Irany: ${vissza ? "vissza a UNAS-alapu handle-re" : "a WEBSHOP-slugra"}; kotott termek a boltban: ${rows.length + celNelkul}; ervenyes cel nelkul: ${celNelkul}; a kotes Medusa-termeke nincs meg: ${boltbanNincs}\n`,
  );
  out.stdout(describeHandleSwitch(plan));
  if (!apply) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }
  let irva = 0;
  const hibak: string[] = [];
  for (const r of plan.order) {
    try {
      await client.setProductHandle(r.medusaId, r.desired);
      irva += 1;
    } catch (error) {
      hibak.push(
        `${r.productId} ${r.current} -> ${r.desired}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  out.stdout(`ALKALMAZVA: ${irva} handle; hiba: ${hibak.length}\n`);
  for (const h of hibak) out.stderr(`  hiba: ${h}\n`);
  return hibak.length ||
    plan.conflicts.length ||
    plan.cycles.length ||
    plan.blocked.length
    ? 2
    : 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runHandleSwitchCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runHandleSwitchCli(process.argv.slice(2), out, {
    client: () => medusaClientForProjection(storedCredentialProvider(), out),
    sources: prismaHandleSources,
    env: process.env,
  });
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
