import type { CatalogActionKind } from "@acropora/types";

import {
  brandBackfillDependencies,
  runBrandBackfillCli,
} from "../imports/unas/unas-brand-backfill.cli.js";
import { runBrandLinkCli } from "../integrations/medusa/medusa-brand-link.cli.js";
import {
  brandFromNameDependencies,
  runBrandFromNameCli,
} from "../products/brand-from-name.cli.js";
import {
  BrandListInputError,
  parseBrandListInput,
} from "../products/brand-from-list.js";
import {
  brandFromListDependencies,
  runBrandFromListAction,
} from "../products/brand-from-list.run.js";
import {
  categoryCliDependencies,
  runCategoryCli,
} from "../integrations/medusa/medusa-category.cli.js";

/** Where a command writes; the run collects both streams into one text. */
export interface CatalogActionOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/** The request body of a kind that takes a list is not usable; the message is for the person who wrote it. */
export class CatalogActionInputError extends Error {}

export interface CatalogActionRunner {
  kind: CatalogActionKind;
  title: string;
  description: string;
  /**
   * Only for a kind that takes input (a list): turns the plan request's body into the input, or throws
   * `CatalogActionInputError`. A kind without it takes no input and its plan ignores the body.
   */
  parseInput?(body: unknown): unknown;
  /** Runs the command once and returns its exit code. It may throw. `input` is what `parseInput` returned. */
  run(
    apply: boolean,
    actorUserId: string,
    out: CatalogActionOutput,
    input?: unknown,
  ): Promise<number>;
}

/**
 * THE OPERATIONS, each the existing command's own function with the same
 * arguments the command line would pass. Nothing of the commands' logic is
 * repeated here: a new kind is one more entry (the categories, #1910, are the
 * third).
 */
/**
 * The categories' command with the arguments the command line would pass: a
 * plan is NO argument (the command's default writes nothing), an apply is
 * `--apply`. The command and its dependencies are parameters so the mapping is
 * measurable without a Medusa.
 */
export function runCategoriesAction(
  apply: boolean,
  out: CatalogActionOutput,
  run: typeof runCategoryCli = runCategoryCli,
  dependencies: typeof categoryCliDependencies = categoryCliDependencies,
): Promise<number> {
  return run(apply ? ["--apply"] : [], out, dependencies(out));
}

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
  {
    kind: "categories",
    title: "Kategóriák a teszt webshopban (örökbefogadás)",
    description:
      "A teszt webshop kategóriái közül a régebbi, idegen azonosítójú, azonos nevű és szülőjű kategóriák megkapják a mi azonosítónkat, nevünket és webcímünket (a termék-hozzárendelésük megmarad); ami nincs meg, létrejön. A próba kimenete a régi azonosítót tételesen kiírja. A termékeket nem érinti.",
    run: (apply, _actorUserId, out) => runCategoriesAction(apply, out),
  },
  {
    kind: "brand-from-name",
    title: "Márka a termék nevéből (csak üres márkájú termékre)",
    description:
      "Ahol a terméknek nincs márkája, és a neve elején pontosan egy létező márka neve vagy aliasa áll (az első 1-4 egész szó), azt a márkát írja a termékre. Két illő márka esetén nem ír. A próba tételesen kiírja, mit írna. A végrehajtás felelőse a bejelentkezett felhasználó.",
    run: (apply, actorUserId, out) =>
      runBrandFromNameCli(
        apply ? ["--apply", "--actor", actorUserId] : [],
        out,
        brandFromNameDependencies,
      ),
  },
  {
    kind: "brand-from-list",
    title: "Márka egy kiválasztott listából (csak üres márkájú termékre)",
    description:
      "A kérés törzsében kapott [termék, márka] listából írja a márkát: létező márka azonosítójával, vagy egy új márka nevével (ha a név már márka vagy alias, azt találja meg, különben létrehozza). Csak üres márkájú terméket ír, csak a listán szereplőt. Az Acropora saját márkát nem írja. Egy hibás tétel az egész próbát megbuktatja. A végrehajtás a próba listáját írja. A próba tételesen kiírja, mit írna; a futás felelőse a bejelentkezett felhasználó.",
    parseInput: (body) => {
      try {
        return parseBrandListInput(body);
      } catch (error) {
        if (error instanceof BrandListInputError)
          throw new CatalogActionInputError(error.message);
        throw error;
      }
    },
    run: (apply, actorUserId, out, input) =>
      runBrandFromListAction(
        apply,
        actorUserId,
        input as ReturnType<typeof parseBrandListInput>,
        out,
        brandFromListDependencies,
      ),
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
