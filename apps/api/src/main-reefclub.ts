import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { assertKnownNodeEnv } from "./common/node-env.guard.js";
import { configureReefClubApp } from "./reefclub/reefclub-app.configuration.js";
import { DIAG_UNTIL_ENV, diagState } from "./reefclub/reefclub-diag.js";
import { assertReefClubEnvironment } from "./reefclub/reefclub-environment.js";
import { ReefClubAppModule } from "./reefclub/reefclub.module.js";

/**
 * THE REEFCLUB ENTRY POINT (plan v6.1, 2.1): the same code base as `main.ts`,
 * a different root module. Only the ReefClub module is loaded, and the
 * environment is checked before anything else is built, so a process started
 * with the internal `.env` stops here instead of serving with it.
 */
async function bootstrap() {
  assertKnownNodeEnv();
  assertReefClubEnvironment(process.env);

  const diag = diagState(process.env);
  if (diag.state === "OPEN")
    console.warn(
      `FIGYELEM: a /rc/v1/health kiírja a hívó címét és az X-Forwarded-For láncot ${diag.until!.toISOString()}-ig (${DIAG_UNTIL_ENV}); csak mérésre.`,
    );
  else if (diag.state === "INVALID" || diag.state === "TOO_FAR")
    console.warn(
      `FIGYELEM: a ${DIAG_UNTIL_ENV} értéke ${diag.state === "INVALID" ? "érvénytelen (időzónás ISO időpont kell)" : "az indulástól számítva több mint 2 órára van"}, a diagnosztika ZÁRVA marad.`,
    );

  const app = await NestFactory.create(ReefClubAppModule.forRoot());

  configureReefClubApp(app);

  const port = Number(process.env.REEFCLUB_PORT ?? 3002);
  await app.listen(port);
  console.log(`Acropora ReefClub API: http://localhost:${port}`);
}

void bootstrap();
