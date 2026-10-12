import { pathToFileURL } from "node:url";

import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPdfClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzConnectionRepository } from "../integrations/szamlazz/szamlazz-connection.repository.js";
import { SzamlazzCredentialCryptoService } from "../integrations/szamlazz/szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  createDocumentStore,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import {
  fillExternalInvoicePdfs,
  monthRange,
  prismaExternalPdfStore,
  type ExternalPdfStore,
} from "./external-invoice-pdf-fill.js";

/**
 * A SZÁMLÁZZ.HU-N KIÁLLÍTOTT SZÁMLÁK PDF-JÉNEK PÓTLÁSA, havonta is futtatható:
 *
 *   pnpm --filter @acropora/api external-invoice-pdf:fill [--month ÉÉÉÉ-HH] [--apply]
 *
 * Az `--apply` csak megnevezett hónapra fut, vagy kifejezett `--all-months`-szal:
 * egy elgépelt parancs ne kérje le az összes hónapot (barracuda, #1658). A
 * Számlázz.hu 7-es hibájával (nincs ilyen szám) jelölt sor alapból kimarad,
 * mert újra sem fog sikerülni; a `--retry-unknown` mégis újrapróbálja.
 *
 * Argumentum nélkül CSAK SZÁMOL: kiírja, hány PDF nélküli SZAMLAZZ-forrású
 * számla van, és a Számlázz.hu-t nem hívja. A letöltés és a tárolás az
 * `--apply`. A Számlázz.hu-ban semmit nem változtat (csak olvas), a mi
 * oldalunkon a dokumentumtárba és a sor PDF-mezőibe ír.
 *
 * Kilépési kód: 0 nincs teendő vagy minden PDF megjött; 1 száraz futás, VAN
 * teendő; 2 rossz hónap, `--apply` hónap nélkül, vagy `--apply` dokumentumtár
 * nélkül; 3 legalább egy
 * PDF nem jött meg (a sor `pdfMissingReason`-t kapott).
 */
export async function main(
  argv: readonly string[],
  io: { out: (text: string) => void; err: (text: string) => void } = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  },
  deps: {
    store?: ExternalPdfStore;
    documents?: () => Pick<DocumentStore, "put"> | null;
    credential?: () => Promise<{ agentKey: string; revision: string }>;
    client?: SzamlazzAgentPdfClient;
  } = {},
): Promise<number> {
  const at = argv.indexOf("--month");
  const month = at >= 0 ? (argv[at + 1] ?? "") : null;
  if (month !== null) {
    try {
      monthRange(month);
    } catch (error) {
      io.err(`${(error as Error).message}\n`);
      return 2;
    }
  }
  const apply = argv.includes("--apply");
  if (apply && month === null && !argv.includes("--all-months")) {
    io.err(
      "Az --apply egy hónapra fut (--month ÉÉÉÉ-HH), vagy kifejezetten mindre: --all-months\n",
    );
    return 2;
  }
  const store = deps.store ?? prismaExternalPdfStore;
  const candidates = await store.candidates(month, {
    retryUnknown: argv.includes("--retry-unknown"),
  });
  const scope = month ? `${month} kelte` : "minden hónap";
  io.out(
    `PDF nélküli Számlázz.hu-számla (${scope}): ${candidates.length}\n` +
      candidates
        .map(
          (c) =>
            `  ${c.issueDate.toISOString().slice(0, 10)} ${c.documentNumber}\n`,
        )
        .join(""),
  );
  if (candidates.length === 0) return 0;
  if (!apply) {
    io.out(
      "Ez a futás nem hívta a Számlázz.hu-t, és nem írt. A letöltéshez: --apply\n",
    );
    return 1;
  }

  const documents = (
    deps.documents ??
    (() =>
      documentStoreEnabled(process.env)
        ? createDocumentStore(process.env)
        : null)
  )();
  if (!documents) {
    io.err(
      "A dokumentumtár nincs beállítva (DOCUMENT_STORE_ROOT): a PDF-et nem lenne hová tenni.\n",
    );
    return 2;
  }
  const credential = await (
    deps.credential ??
    (() =>
      new SzamlazzCredentialProvider(
        new SzamlazzConnectionRepository(),
        new SzamlazzCredentialCryptoService(),
      ).resolve())
  )();
  const outcomes = await fillExternalInvoicePdfs({
    candidates,
    agentKey: credential.agentKey,
    client: deps.client ?? new HttpSzamlazzAgentClient(),
    documents,
    store,
  });
  const failed = outcomes.filter((o) => o.kind === "FAILED");
  io.out(
    `Letöltve (kulcs: ${credential.revision}): ${outcomes.length - failed.length}, nem jött meg: ${failed.length}\n` +
      failed
        .map(
          (o) =>
            `  ${o.documentNumber} ${o.kind === "FAILED" ? o.reason : ""}\n`,
        )
        .join(""),
  );
  return failed.length ? 3 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 2;
    });
}
