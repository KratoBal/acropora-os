import type { CatalogActionKind } from "@acropora/types";

import {
  brandBackfillDependencies,
  runBrandBackfillCli,
} from "../imports/unas/unas-brand-backfill.cli.js";
import { runBrandLinkCli } from "../integrations/medusa/medusa-brand-link.cli.js";

/** Where a command writes; the run collects both streams into one text. */
export interface CatalogActionOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CatalogActionRunner {
  kind: CatalogActionKind;
  title: string;
  description: string;
  /** Runs the command once and returns its exit code. It may throw. */
  run(
    apply: boolean,
    actorUserId: string,
    out: CatalogActionOutput,
  ): Promise<number>;
}

/**
 * THE OPERATIONS, each the existing command's own function with the same
 * arguments the command line would pass. Nothing of the commands' logic is
 * repeated here: a new kind (the categories, #1910) is one more entry.
 */
export const CATALOG_ACTION_RUNNERS: readonly CatalogActionRunner[] = [
  {
    kind: "brand-backfill",
    title: "Márkák a termékekre a tárolt UNAS-pillanatképből",
    description:
      "A termékek tárolt UNAS-adatának „brand” paraméteréből márka-rekordot hoz létre, és a termékre írja. Az UNAS-t nem hívja. A végrehajtás felelőse a bejelentkezett felhasználó.",
    run: (apply, actorUserId, out) =>
      runBrandBackfillCli(
        apply ? ["--apply", "--actor", actorUserId] : [],
        out,
        brandBackfillDependencies,
      ),
  },
  {
    kind: "brand-links",
    title: "Márka-kötések átvitele a webshopba",
    description:
      "A márkás termékek márkáját és a márka adatait kiírja a teszt webshop márka-moduljába, a termék törzsének írása nélkül.",
    run: (apply, _actorUserId, out) =>
      runBrandLinkCli(apply ? ["--apply"] : [], out),
  },
];

export const CATALOG_ACTION_RUNNERS_TOKEN = Symbol("CATALOG_ACTION_RUNNERS");
export const CATALOG_ACTIONS_ENV = Symbol("CATALOG_ACTIONS_ENV");

/**
 * THE SWITCH: on only where the environment says so. Production has no value,
 * so the operations do not exist there (the commerce exception is for the test
 * OS only).
 */
export function catalogActionsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.CATALOG_ADMIN_ACTIONS_ENABLED === "true";
}
