import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  feedPullReport,
  pullFromSzamlazz,
  type FeedPullDeps,
} from "./feed-pull.js";
import { HttpSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzConnectionRepository } from "../integrations/szamlazz/szamlazz-connection.repository.js";
import { SzamlazzCredentialCryptoService } from "../integrations/szamlazz/szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { SzamlazzFeedsRepository } from "../missing-invoices/szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "../missing-invoices/szamlazz-feeds.service.js";

/**
 * A FEEDBŐL HIÁNYZÓ SZÁMLA BEHÚZÁSA PARANCSSORBÓL, fejlesztéshez és teszthez (a szabály és a kivétel: `feed-pull.ts`).
 * Élesen a Napi jelölés lapjának gombja indítja.
 *
 *   pnpm --filter @acropora/api billing:feed-pull ACRW-2026/00469 [további számok...]           (száraz)
 *   pnpm --filter @acropora/api billing:feed-pull --apply ACRW-2026/00469 [további számok...]
 */
export async function main(
  argv: readonly string[],
  out: (text: string) => void,
  deps?: FeedPullDeps,
): Promise<number> {
  const apply = argv.includes("--apply");
  const numbers = argv.filter((arg) => arg !== "--apply");
  if (
    numbers.length === 0 ||
    numbers.some((n) => !/^(?:[A-Z]+-)?\d{4}\/\d+$/i.test(n))
  ) {
    out(
      "Használat: feed-pull [--apply] <pontos számlaszám...>, például ACRW-2026/00469 vagy 2026/00083\n",
    );
    return 2;
  }
  const lines = await pullFromSzamlazz(
    numbers,
    apply,
    deps ?? productionDeps(),
  );
  out(feedPullReport(lines, apply));
  return lines.every(
    (l) => l.outcome === "WOULD_STORE" || l.outcome === "STORED",
  )
    ? 0
    : 1;
}

function productionDeps(): FeedPullDeps {
  const repository = new SzamlazzFeedsRepository();
  const service = new SzamlazzFeedsService(repository, {});
  return {
    agentKey: async () =>
      (
        await new SzamlazzCredentialProvider(
          new SzamlazzConnectionRepository(),
          new SzamlazzCredentialCryptoService(),
        ).resolve()
      ).agentKey,
    client: new HttpSzamlazzAgentClient(),
    store: (input) => repository.storeRaw({ kind: "SZAMLAKI", ...input }),
    project: (externalId, sha256, body) =>
      service.intoBilling(externalId, sha256, body),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), (text) => process.stdout.write(text))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      process.stderr.write(
        `${cause instanceof Error ? cause.name : "UNKNOWN"}: a parancs megállt\n`,
      );
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
