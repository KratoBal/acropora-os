import { Inject, Injectable, Optional } from "@nestjs/common";

import { prismaRedirectSource } from "./medusa-redirect.cli.js";
import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import {
  redirectPlan,
  type MedusaRedirectPlanView,
} from "./medusa-redirect-plan.js";

/** Teszt-illesztés (ugyanaz a minta, mint az ár-ellenőrzésnél): a valódi futtató a tárolt kulccsal olvas. */
export const MEDUSA_REDIRECT_PLAN_RUNNER = Symbol(
  "MEDUSA_REDIRECT_PLAN_RUNNER",
);

export type RedirectPlanRunner = () => Promise<MedusaRedirectPlanView>;

/**
 * A VETÍTÉS TERVÉNEK OLVASÓ VÉGPONTJA (`GET health/medusa-redirect-plan`, task t-20261118-vetites-terv-get): a `medusa-redirect` szárazfutásának
 * tartalma JSON-ban, mert a stage-en a parancs kimenete nem látszik (egy Coolify egyszeri feladat csak success/failed). Semmit nem küld a boltba.
 */
@Injectable()
export class MedusaRedirectPlanService {
  private readonly runner: RedirectPlanRunner;

  constructor(
    @Optional()
    @Inject(MEDUSA_REDIRECT_PLAN_RUNNER)
    runner?: RedirectPlanRunner,
  ) {
    this.runner =
      runner ??
      (async () =>
        redirectPlan(
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: () => undefined,
            stderr: () => undefined,
          }),
          prismaRedirectSource,
        ));
  }

  plan(): Promise<MedusaRedirectPlanView> {
    return this.runner();
  }
}
