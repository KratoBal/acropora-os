import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { describeTarget } from "../common/database-target.js";
import { PrismaManualListStore } from "./customer-candidates-manual.repository.js";
import {
  parseImportArgs,
  runManualImport,
} from "./customer-candidates-manual.import.js";

/**
 * `pnpm --filter @acropora/api customer-candidates:import <fájl> [--apply --approved-by "..." --fingerprint ...]`: a kézi terméklista
 * betöltése (V3.4 S2c). A logika a `customer-candidates-manual.import.ts`-ben van, adatbázis nélkül tesztelve; ez csak a bekötés.
 */
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const options = parseImportArgs(process.argv.slice(2));
  if ("error" in options) {
    process.stderr.write(`${options.error}\n`);
    process.exit(2);
  }
  runManualImport(
    options,
    {
      store: new PrismaManualListStore(),
      readFile: (path) => readFile(path, "utf8"),
      now: () => new Date(),
      target: describeTarget(process.env.DATABASE_URL),
    },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  )
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(
        `A parancs elbukott: ${error instanceof Error ? error.name : "ismeretlen hiba"}\n`,
      );
      process.exit(1);
    });
}
