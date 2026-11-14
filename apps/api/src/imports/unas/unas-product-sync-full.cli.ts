import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { UnasApiClient } from "./unas-api.client.js";
import { UnasAuthService } from "./unas-auth.service.js";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
import { UnasClock } from "./unas-login-expiry.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import {
  FULL_SYNC_USAGE,
  runUnasProductSyncFull,
} from "./unas-product-sync-full.mag.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";

/**
 * The command line form only: it exports nothing, and the body (`.mag.ts`) never imports it back.
 * The wiring below is the same graph `UnasImportModule` builds for the HTTP and scheduler paths.
 */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(FULL_SYNC_USAGE);
    process.exit(0);
  }
  const apiClient = new UnasApiClient();
  const auth = new UnasAuthService(
    apiClient,
    new UnasCredentialProvider(
      new UnasConnectionRepository(),
      new UnasCredentialCryptoService(),
    ),
    new UnasClock(),
  );
  const repository = new UnasProductSyncRepository();
  const sync = new UnasProductSyncService(
    apiClient,
    new UnasProductCanonicalizer(),
    new UnasProductSyncDiffEngine(),
    repository,
  );
  const code = await runUnasProductSyncFull(
    args,
    {
      getToken: () => auth.getToken(),
      runFull: async (token) => ({
        runId: (await sync.runIncremental(token, undefined, undefined, true))
          .runId,
      }),
      readRun: (runId) => repository.getRun(runId),
    },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
