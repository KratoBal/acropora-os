import { ValidationPipe, type INestApplication } from "@nestjs/common";

import { applyHttpTimeouts } from "../http-timeouts.js";
import { reefClubWebUrl } from "./reefclub-mail.js";

/**
 * What the running ReefClub process is configured with, callable from a test
 * for the same reason as `configureApp` (see `app.configuration.ts`). The
 * validation rules are the internal API's, deliberately: an unknown field is
 * refused, not stripped (plan 3.1).
 */
export function configureReefClubApp(app: INestApplication): void {
  app.enableCors({ origin: reefClubWebUrl(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  applyHttpTimeouts(app.getHttpServer());
}
