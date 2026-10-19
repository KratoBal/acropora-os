import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { ReefClubAccountRepository } from "./reefclub-account.repository.js";
import { ReefClubAuthController } from "./reefclub-auth.controller.js";
import { ReefClubAuthService } from "./reefclub-auth.service.js";
import {
  REEFCLUB_DATABASE_ADDRESS,
  ReefClubDatabase,
  reefClubDatabaseUrl,
} from "./reefclub-database.js";
import { ReefClubHealthController } from "./reefclub-health.controller.js";
import type { MailSender } from "../notifications/mail/mail.port.js";
import {
  createReefClubMailSender,
  REEFCLUB_MAIL_SENDER,
} from "./reefclub-mail.js";
import { ReefClubMeController } from "./reefclub-me.controller.js";
import { ReefClubRateLimits } from "./reefclub-rate-limits.js";
import { ReefClubSessionRepository } from "./reefclub-session.repository.js";
import { ReefClubGuard } from "./reefclub.guard.js";

export interface ReefClubModuleOptions {
  /**
   * The mail sender; the default is the ReefClub's own Gmail sender
   * (`createReefClubMailSender`). Tests pass a capturing one, through the same
   * root module the entry point uses, so the wiring they measure is the
   * production wiring with one seam.
   */
  mailSender?: MailSender;
  /**
   * The database address; the default is `REEFCLUB_DATABASE_URL`. The
   * integration spec passes the test database the common run already uses,
   * so it needs no environment of its own.
   */
  databaseUrl?: string;
}

/**
 * The ReefClub feature module: its controllers, its repositories, its own
 * database client and its own mail sender. It imports NOTHING from the
 * internal modules (no `AuthModule`, no `NotificationsModule`, no
 * `AquariumsModule`), only plain functions and classes it constructs itself,
 * so loading it pulls no internal provider into the process.
 */
@Module({})
export class ReefClubModule {
  static forRoot(options: ReefClubModuleOptions = {}): DynamicModule {
    return {
      module: ReefClubModule,
      controllers: [
        ReefClubAuthController,
        ReefClubMeController,
        ReefClubHealthController,
      ],
      providers: [
        {
          provide: REEFCLUB_DATABASE_ADDRESS,
          useFactory: () => options.databaseUrl ?? reefClubDatabaseUrl(),
        },
        ReefClubDatabase,
        ReefClubAccountRepository,
        ReefClubSessionRepository,
        ReefClubAuthService,
        ReefClubRateLimits,
        ReefClubGuard,
        {
          provide: REEFCLUB_MAIL_SENDER,
          useFactory: () => options.mailSender ?? createReefClubMailSender(),
        },
      ],
      exports: [ReefClubGuard],
    };
  }
}

/**
 * THE ROOT MODULE OF THE REEFCLUB PROCESS (plan v6.1, 2.1), loaded only by
 * `main-reefclub.ts`. It holds the ReefClub module and the ReefClub guard as
 * the application guard, and nothing else: the internal controllers are not
 * in this process at all, so a mistake in the gateway rule cannot expose one.
 *
 * The guard is registered HERE and not inside `ReefClubModule`: an
 * `APP_GUARD` is global to whichever application loads the module, and if the
 * feature module were ever imported into the internal `AppModule` by mistake,
 * a guard inside it would start judging every internal route.
 */
@Module({})
export class ReefClubAppModule {
  static forRoot(options: ReefClubModuleOptions = {}): DynamicModule {
    return {
      module: ReefClubAppModule,
      imports: [ReefClubModule.forRoot(options)],
      providers: [{ provide: APP_GUARD, useExisting: ReefClubGuard }],
    };
  }
}
