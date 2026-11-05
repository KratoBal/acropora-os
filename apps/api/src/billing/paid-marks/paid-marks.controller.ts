import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { FeedBackfillDto } from "./dto/feed-backfill.dto.js";
import { FeedPullDto } from "./dto/feed-pull.dto.js";
import { RunNowDto } from "./dto/run-now.dto.js";
import { FeedBackfillService } from "./feed-backfill.service.js";
import { FeedPullService } from "./feed-pull.service.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";
import { PaidMarksAutoScheduler } from "./paid-marks-auto.scheduler.js";

/**
 * THE LATEST AUTOMATIC PAID-MARK RUN PER SOURCE (acrobot 26101): what was
 * written, and what needs a person. The dashboard's "Figyelmet igényel" tile
 * (planned in the dashboard batch, `attention`) reads the `attention` items.
 */
@Controller("billing/paid-marks")
export class PaidMarksController {
  constructor(
    private readonly runs: PaidMarkRunRepository,
    private readonly scheduler: PaidMarksAutoScheduler,
    private readonly feedPull: FeedPullService,
    private readonly backfill: FeedBackfillService,
  ) {}

  @Get("latest")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  latest() {
    return this.runs.latest();
  }

  /** Each source's switch and whether a run is in flight (e64540fd). */
  @Get("status")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  status() {
    return { ...this.scheduler.status(), sources: this.scheduler.modes() };
  }

  /**
   * "FUTTATÁS MOST" (Balázs, 2026-11-05; e64540fd): the daily run by hand, with the same code and the
   * same switches. The right is the one that marks a bank transfer paid by hand (`BILLING_ISSUE`, the
   * pairing's write). 202: started; the outcome lands in `latest`. A run in flight answers `running`.
   */
  @Post("run")
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  run(@Body() input: RunNowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.scheduler.runNow(user.id, new Date(), {
      allTime: input?.allTime === true,
    });
  }

  /**
   * "LEKÉRÉS A SZÁMLÁZZ.HU-BÓL" (aeddb2c3, acrobot 43506): a feedből hiányzó számla behúzása a "nincs a Számlázz.hu
   * feedben" sorról. `apply: false` a száraz előnézet (a Számlázz.hu-n csak olvas), `apply: true` a behúzás. A jog a
   * "Futtatás most"-é (`BILLING_ISSUE`), mert a behúzott számla a következő futásban jelölhetővé válik.
   */
  @Post("feed-pull")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  pullIntoFeed(
    @Body() input: FeedPullDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.feedPull.pull(input.numbers, input.apply, user.id);
  }

  /**
   * A TÁROLT FEED VISSZATÖLTÉSE AZ ÉV ELEJÉIG (6fd8c574; acrobot 43766): sorozatonként a feedből hiányzó számok, és amit
   * a Számlázz.hu rájuk felelt (az ACRW sorozat külön látszik).
   */
  @Get("feed-backfill")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  backfillStatus() {
    return this.backfill.status();
  }

  /**
   * A visszatöltés egy köre: `apply: false` a száraz (minden hiányzó számot megkérdez, a Számlázz.hu-n csak olvas),
   * `apply: true` a behúzás (csak amit a Számlázz.hu ismer), utána egyszer a kifizetett-jelölés korhatár nélkül. 202: a
   * kör elindult, a lap a `feed-backfill` állapotból olvassa. A jog a "Lekérés"-é (`BILLING_ISSUE`).
   */
  @Post("feed-backfill")
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  startBackfill(
    @Body() input: FeedBackfillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.backfill.start(input.apply, user.id);
  }
}
